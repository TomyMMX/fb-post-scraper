import Apify from 'apify';
import { InfoError } from './error';
import { LABELS, CSS_SELECTORS } from './constants';
import * as fns from './functions';
import {
    getPostContent,
    getPostInfoFromScript,
    getVideoUrl,
    isNotFoundPage,
} from './page';
import { statePersistor, emptyState } from './storage';
import type { Schema, FbLabel, FbPost } from './definitions';

import LANGUAGES = require('./languages.json');

const { log, puppeteer } = Apify.utils;

const {
    getUrlLabel,
    setLanguageCodeToCookie,
    extractUsernameFromUrl,
    stopwatch,
    executeOnDebug,
    storyFbToDesktopPermalink,
    proxyConfiguration,
    resourceCache,
    photoToPost,
} = fns;

Apify.main(async () => {
    const input: Schema | null = await Apify.getInput() as any;

    if (!input || typeof input !== 'object') {
        throw new Error('Missing input');
    }

    const {
        startUrls = [],
        maxPosts = 1,
        scrapePosts = true,
        language = 'en-US',
        sessionStorage = '',
        useStealth = false,
        debugLog = false
    } = input;

    if (debugLog) {
        log.setLevel(log.LEVELS.DEBUG);
    }

    if (!Array.isArray(startUrls) || !startUrls.length) {
        throw new Error('You must provide the "startUrls" input');
    }

    const proxyConfig = await proxyConfiguration({
        proxyConfig: input.proxyConfiguration,
        hint: ['RESIDENTIAL'],
        required: true,
    });

    const residentialWarning = () => {
        if (Apify.isAtHome() && !proxyConfig?.groups?.includes('RESIDENTIAL')) {
            log.warning(`!!!!!!!!!!!!!!!!!!!!!!!\n\nYou're not using RESIDENTIAL proxy group, it won't work as expected. Contact support@apify.com or on Intercom to give you proxy trial\n\n!!!!!!!!!!!!!!!!!!!!!!!`);
        }
    };

    residentialWarning();

    let handlePageTimeoutSecs = Math.round(60 * ((maxPosts || 10) * 0.08)) + 600; // minimum 600s

    if (handlePageTimeoutSecs * 60000 >= 0x7FFFFFFF) {
        log.warning(`maxPosts parameter is too high, must be less than ${0x7FFFFFFF} milliseconds in total, got ${handlePageTimeoutSecs * 60000}. Loading posts and comments might never finish or crash the scraper at any moment.`, {
            maxPosts,
            handlePageTimeoutSecs,
            handlePageTimeout: handlePageTimeoutSecs * 60000,
        });
        handlePageTimeoutSecs = Math.floor(0x7FFFFFFF / 60000);
    }

    log.info(`Will use ${handlePageTimeoutSecs}s timeout for page`);

    const startUrlsRequests = new Apify.RequestList({
        sources: startUrls,
    });

    await startUrlsRequests.initialize();

    if (!(language in LANGUAGES)) {
        throw new Error(`Selected language "${language}" isn't supported`);
    }

    const { map, state, persistState } = await statePersistor();
    const elapsed = stopwatch();

    log.info(`Starting crawler with ${startUrlsRequests.length()} urls`);
    log.info(`Using language "${(LANGUAGES as any)[language]}" (${language})`);

    const requestQueue = await Apify.openRequestQueue();

    let nextRequest;
    const processedRequests = new Set<Apify.Request>();

    // eslint-disable-next-line no-cond-assign
    while (nextRequest = await startUrlsRequests.fetchNextRequest()) {
        processedRequests.add(nextRequest);
    }

    if (startUrls?.length && !processedRequests.size) {
        throw new Error('No requests were loaded from startUrls');
    }

    const initVideoPage = async (url: string, username: string) => {
        await requestQueue.addRequest({
            url: url,
            userData: {
                label: LABELS.VIDEO,
                ref: url,
                useMobile: true,
                username,
            },
        }, { forefront: true });
    };

    for (const request of processedRequests) {
        try {
            let { url } = request;
            const urlType = getUrlLabel(url);

            if (urlType === LABELS.POST || urlType === LABELS.PHOTO) {
                if (LABELS.PHOTO) {
                    url = photoToPost(url) ?? url;
                }

                const username = extractUsernameFromUrl(url);

                await requestQueue.addRequest({
                    url,
                    userData: {
                        label: LABELS.POST,
                        useMobile: false,
                        username,
                        canonical: storyFbToDesktopPermalink(url)?.toString(),
                    },
                });
            }
        } catch (e) {
            if (e instanceof InfoError) {
                // We want to inform the rich error before throwing
                log.warning(`------\n\n${e.message}\n\n------`, e.toJSON());
            } else {
                throw e;
            }
        }
    }

    const maxConcurrency = process.env?.MAX_CONCURRENCY ? +process.env.MAX_CONCURRENCY : undefined;
    const cache = resourceCache([
        /rsrc\.php/,
    ]);

    const crawler = new Apify.PuppeteerCrawler({
        requestQueue,
        useSessionPool: true,
        sessionPoolOptions: {
            persistStateKeyValueStoreId: sessionStorage || undefined,
            maxPoolSize: sessionStorage ? 1 : undefined,
            sessionOptions: {
                maxErrorScore: 0.5,
            },
        },
        maxRequestRetries: 10,
        maxConcurrency,
        proxyConfiguration: proxyConfig,
        launchContext: {
            stealth: useStealth,
            launchOptions: {
                devtools: debugLog,
                useIncognitoPages: true,
            },
        },
        browserPoolOptions: {
            maxOpenPagesPerBrowser: 2, // required to use one IP per tab
        },
        persistCookiesPerSession: sessionStorage !== '',
        handlePageTimeoutSecs, // more comments, less concurrency
        preNavigationHooks: [async ({ page, request }, gotoOptions) => {
            gotoOptions.waitUntil = request.userData.label === LABELS.POST || (request.userData.label === LABELS.PAGE && ['posts', 'reviews'].includes(request.userData.sub))
                ? 'load'
                : 'domcontentloaded';
            gotoOptions.timeout = 60000;

            await setLanguageCodeToCookie(language, page);

            await executeOnDebug(async () => {
                await page.exposeFunction('logMe', (...args: any[]) => {
                    console.log(...args); // eslint-disable-line no-console
                });
            });

            await page.exposeFunction('unhideChildren', (element?: HTMLElement) => {
                // weird bugs happen in this function, sometimes the dom element has no querySelectorAll for
                // unknown reasons
                if (!element) {
                    return;
                }

                element.className = '';
                if (typeof element.removeAttribute === 'function') {
                    // weird bug that sometimes removeAttribute isn't a function?
                    element.removeAttribute('style');
                }

                if (typeof element.querySelectorAll === 'function') {
                    for (const el of [...element.querySelectorAll<HTMLElement>('*')]) {
                        el.className = ''; // removing the classes usually unhides

                        if (typeof element.removeAttribute === 'function') {
                            el.removeAttribute('style');
                        }
                    }
                }
            });

            await cache(page);

            // make the page a little more lightweight
            await puppeteer.blockRequests(page, {
                urlPatterns: [
                    '.woff',
                    '.webp',
                    '.mov',
                    '.mpeg',
                    '.mpg',
                    '.mp4',
                    '.woff2',
                    '.ttf',
                    '.ico',
                    'scontent-',
                    'scontent.fplu',
                    'safe_image.php',
                    'static_map.php',
                    'ajax/bz',
                ],
            });

            const { userData: { useMobile } } = request;

            // listing need to start in a desktop version
            // page needs a mobile viewport
            const userAgent = useMobile
                ? 'Mozilla/5.0 (Linux; Android 10; SM-A205U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36'
                : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36';

            request.userData.userAgent = userAgent;

            await page.emulate({
                userAgent,
                viewport: {
                    height: useMobile ? 700 : 1080,
                    width: useMobile ? 400 : 1920,
                    hasTouch: useMobile,
                    isMobile: useMobile,
                    deviceScaleFactor: useMobile ? 2 : 1,
                },
            });
/*
            await page.evaluateOnNewDocument(() => {
                const f = () => {
                    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-testid="cookie-policy-dialog-accept-button"],[data-cookiebanner="accept_button"],#accept-cookie-banner-label')) {
                        if (btn) {
                            btn.click();
                        }
                    }
                    setTimeout(f, 1000);
                };
                setTimeout(f);
            });
*/
        }],
        handlePageFunction: async ({ request, page, session, browserController }) => {
            const { userData } = request;

            const label: FbLabel = userData.label; // eslint-disable-line prefer-destructuring

            log.debug(`Visiting page ${request.url}`);

            try {
                if (page.url().includes('?next=')) {
                    throw new InfoError(`Content needs login to work, this will be retried but most likely won't work as expected`, {
                        url: request.url,
                        namespace: 'login',
                        userData,
                    });
                }

                if (userData.useMobile) {
                    // need to do some checks if the current mobile page is the interactive one or if
                    // it has been blocked
                    if (await page.$(CSS_SELECTORS.MOBILE_CAPTCHA)) {
                        throw new InfoError('Mobile captcha found', {
                            url: request.url,
                            namespace: 'captcha',
                            userData,
                        });
                    }

                    try {
                        await Promise.all([
                            page.waitForSelector(CSS_SELECTORS.MOBILE_META, {
                                timeout: 15000, // sometimes the page takes a while to load the responsive interactive version
                            }),
                            page.waitForSelector(CSS_SELECTORS.MOBILE_BODY_CLASS, {
                                timeout: 15000, // correctly detected android. if this isn't the case, the image names will change
                            }),
                        ]);
                    } catch (e) {
                        throw new InfoError('An unexpected page layout was returned by the server. This request will be retried shortly.', {
                            url: request.url,
                            namespace: 'mobile-meta',
                            userData,
                        });
                    }
                }

                if (!userData.useMobile && await page.$(CSS_SELECTORS.DESKTOP_CAPTCHA)) {
                    throw new InfoError('Desktop captcha found', {
                        url: request.url,
                        namespace: 'captcha',
                        userData,
                    });
                }

                if (await page.$eval('title', (el) => el.textContent === 'Error')) {
                    throw new InfoError('Facebook internal error, maybe it\'s going through instability, it will be retried', {
                        url: request.url,
                        namespace: 'internal',
                        userData,
                    });
                }

                if (label === LABELS.POST) {
                    const postTimer = stopwatch();

                    log.debug('Started processing post', { url: request.url });

                    // actually parse post content here, it doesn't work on
                    // mobile address
                    const { username, canonical } = userData;

                    var [postStats, content] = await Promise.all([
                        getPostInfoFromScript(page, canonical),
                        getPostContent(page)
                    ]);

                    content = {
                        ... content,
                        postStats
                    }

                    await map.write(username, content);

                    if (content.postImages) {
                        for (const img of content.postImages) {
                            if (img.link.includes('/videos/')) {
                                await initVideoPage(img.link.replace('/www.', '/m.'), username);
                            }
                        }
                    }

                    log.info(`Processed post in ${postTimer() / 1000}s`, { url: request.url });
                } else if (label === LABELS.VIDEO) {
                    const postTimer = stopwatch();
                    log.debug('Started processing video', { url: request.url });
                    const { username } = userData;

                    var videoUrl = await getVideoUrl(page);
                    await map.append(username, async (value) => {
                        return {
                            ... value,
                            postVideos: [
                                {
                                    videoUrl: videoUrl
                                }
                            ]
                        }
                    });
                    log.info(`Processed video in ${postTimer() / 1000}s`, { url: request.url });
                }
            } catch (e) {
                log.debug(e.message, {
                    url: request.url,
                    userData: request.userData,
                    error: e,
                });

                if (e instanceof InfoError) {
                    // We want to inform the rich error before throwing
                    log.warning(e.message, e.toJSON());

                    if (['captcha', 'mobile-meta', 'getFieldInfos', 'internal', 'login', 'threshold'].includes(e.meta.namespace)) {
                        session.retire();
                        await browserController.close(page);
                    }
                }

                throw e;
            } finally {
                
            }

            log.debug(`Done with page ${request.url}`);
        },
        handleFailedRequestFunction: async ({ request, error }) => {
            if (error instanceof InfoError) {
                // this only happens when maxRetries is
                // comprised mainly of InfoError, which is usually a problem
                // with pages
                log.exception(error, 'handleFailedRequestFunction', error.toJSON());
            } else {
                log.error(`Requests failed on ${request.url} after ${request.retryCount} retries`);
            }
        },
    });

    await crawler.run();

    await persistState();

    log.info('Generating dataset...');

    const finished = new Date().toISOString();

    // generate the dataset from all the crawled pages
    //.filter(s => s.categories?.length)
    await Apify.pushData([...state.values()].map(val => ({
        ...val,
        "#version": 3, // current data format version
        '#finishedAt': finished,
    })));

    residentialWarning();

    log.info(`Done in ${Math.round(elapsed() / 60000)}m!`);
});
