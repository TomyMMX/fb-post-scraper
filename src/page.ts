import Apify from 'apify';
import type { Page } from 'puppeteer';
import * as escapeRegex from 'escape-string-regexp';
import get = require('lodash.get');
import type { FbPost, FbPostLink } from './definitions';
import {
    convertDate,

} from './functions';
import { CSS_SELECTORS } from './constants';

const { log, sleep } = Apify.utils;

/**
 * Detects if the current page is a "not found" page (big thumb)
 */
export const isNotFoundPage = async (page: Page) => {
    // real pages have og:url meta
    return !(await page.$(CSS_SELECTORS.VALID_PAGE));
};

/**
 * A couple of regex operations on the post page, that contains
 * statistics about the post itself
 */
export const getPostInfoFromScript = async (page: Page, url: string) => {
    // fetch "timeslice" scripts, don't want related posts
    const html = await page.$$eval('script', async (script, postUrl) => {
        const r = new RegExp(postUrl, 'i');

        return script.filter((s) => {
            return r.test(s.innerHTML);
        }).map((s) => s.innerHTML).join('\n');
    }, escapeRegex(`url:"${url}`));

    const commentsMatch = html.matchAll(/comment_count:{total_count:(\d+)/g);
    const reactionsMatch = html.matchAll(/reaction_count:{count:(\d+)/g);
    const shareMatch = html.matchAll(/share_count:{count:(\d+)/g);

    const maxFromMatches = (matches: IterableIterator<RegExpMatchArray>) => [...matches]
        .reduce((count, [, value]) => (+value > count ? +value : count), 0);

    const reactionsBreakdown = (() => {
        try {
            return eval(`${html.split('top_reactions:{edges:')?.[1].split('}]}')?.[0]}}]`) as any[]; // eslint-disable-line no-eval
        } catch (e) {
            return [];
        }
    })();

    return {
        comments: maxFromMatches(commentsMatch),
        reactions: maxFromMatches(reactionsMatch),
        reactionsBreakdown: reactionsBreakdown.reduce((out, node) => {
            out[`${get(node, ['node', 'reaction_type'], '')}`.toLowerCase()] = node.reaction_count;
            return out;
        }, {}),
        shares: maxFromMatches(shareMatch),
    };
};

/**
 * Get the content from the dedicated post page.
 *
 * Throwing here will propagate to the main error handler,
 * which we are already expecting
 */
export const getPostContent = async (page: Page): Promise<Partial<FbPost>> => {
    await page.waitForSelector(CSS_SELECTORS.POST_CONTAINER);

    const content = await page.$eval(CSS_SELECTORS.POST_CONTAINER, async (el): Promise<Partial<FbPost>> => {
        const postDate = (el.querySelector('[data-utime]') as HTMLDivElement)?.dataset?.utime;
        const userContent = el.querySelector('.userContent') as HTMLDivElement;

        if (!userContent) {
            throw new Error('Missing .userContent');
        }

        //window.unhideChildren(userContent);

        const postText = userContent.innerText.trim();
        const images: HTMLImageElement[] = Array.from(el.querySelectorAll('img[src*="scontent"]'));
        const links: HTMLAnchorElement[] = Array.from(el.querySelectorAll('[href*="l.facebook.com/l.php?u="]'));
        const header: HTMLElement = <HTMLElement>userContent.parentElement?.firstChild
        const userImg: string | null = header?.querySelector('[role="img"]')?.getAttribute('src') || null;
        const userName: string | null = Array.from(header?.querySelectorAll('a')).find(a => a.innerText)?.innerText || null;
        const hasVideo: boolean = userContent.querySelector('video') ? true : false;

        const acc: FbPostLink[] = new Array;
        const postLinks: FbPostLink[] = links.filter(link => link.href).reduce((ret, link) => {
            const url = new URL(link.href).searchParams.get('u');
            if (url) {
                const curUrl = ret.find(l => l.url === url);

                const thumbUrl = link.querySelector('.scaledImageFitWidth')?.getAttribute('src') || null;
                const linkDomain = link.parentElement?.parentElement?.querySelector('.ellipsis')?.innerHTML || null;
                const linkTitle = link.getAttribute('aria-label') || null;
                const linkText = link.querySelector('.accessible_elem')?.innerHTML || null;

                if (curUrl) {
                    if (curUrl.thumbUrl === null) {
                        curUrl.thumbUrl = thumbUrl;
                    }
                    if (curUrl.domain === null) {
                        curUrl.domain = linkDomain;
                    }
                    if (curUrl.title === null) {
                        curUrl.title = linkTitle;
                    }
                    if (curUrl.text === null) {
                        curUrl.text = linkText;
                    }
                } else {
                    const newUrl: FbPostLink = {
                        url: url,
                        thumbUrl: thumbUrl,
                        domain: linkDomain,
                        title: linkTitle,
                        text: linkText
                    }
                    ret.push(newUrl);
                }
            }
            return ret;
        }, acc);

        return {
            name: userName,
            logoUrl: userImg,
            postDate,
            postText,
            postImages: images.filter(img => img.closest('a[rel="theater"]') && img.src).map((img) => {
                return {
                    link: img.closest<HTMLAnchorElement>('a[rel="theater"]')!.href,
                    imageUrl: img.src,
                };
            }),
            postLinks: postLinks
        };
    });

    return {
        ...content,
        postDate: convertDate(content.postDate, true),
        postUrl: page.url(),
    };
};

export const getVideoUrl = async (page: Page): Promise<string|null> => {
    await page.waitForSelector('.widePic');

    const playClicked = await page.$eval('#viewport', async (el): Promise<boolean> => {
        const firstPlayButton = el.querySelector<HTMLDivElement>('.widePic > div > div');
        if (firstPlayButton) {
            firstPlayButton.click();
            return true;
        }
        return false;
    });

    if (playClicked) {
        log.debug('Clicked play...');
        await page.waitForSelector('video');
        log.debug('Video found...');
        return await page.$eval('#viewport', async (el): Promise<string|null> => {
            return el.querySelector('video')?.src || null;
        });
    }

    log.debug('No play ...');
    return null;
};

