export type FbSection = 'home' | 'posts' | 'about' | 'reviews' | 'services';
export type FbLabel = 'LISTING' | 'PAGE' | 'POST' | 'PHOTO' | 'SEARCH';
export type FbCommentsMode = 'RANKED_THREADED' | 'RECENT_ACTIVITY' | 'RANKED_UNFILTERED';
export type FbMap = Map<string, Partial<FbPage>>;

export interface FbGraphQl {
    // only the important parts
    data: {
        feedback: {
            display_comments: {
                count: number;
                edges: Array<{
                    node: {
                        created_time: number;
                        id: string;
                        legacy_fbid: string;
                        author: {
                            name: string;
                            url: string;
                            id: string;
                            profile_picture_depth_0: {
                                uri: string;
                            }
                            profile_picture_depth_1_legacy: {
                                uri: string;
                            }
                        };
                        url: string;
                        body: {
                            text: string;
                        };
                    };
                }>;
                page_info: {
                    has_next_page: boolean;
                };
            };
        };
    };
}

export interface Schema {
    startUrls: Array<string | { url: string }>;
    proxyConfiguration?: any;
    maxPosts?: number;
    scrapePosts?: boolean;
    language?: string;
    sessionStorage?: string;
    useStealth?: boolean;
    debugLog?: boolean;
}

export interface FbPageInfo {
    verified: boolean;
    messenger: string;
    likes: number;
    title: string;
    postalCode: string | null;
    region: string | null;
    city: string | null;
    street: string | null;
}

export interface FbFT {
    top_level_post_id: string;
    page_id: string;
    story_attachment_style: string;
}

export interface FbLocalBusiness {
    name: string;
    address?: {
          streetAddress: string;
          addressLocality: string;
          addressRegion: string;
          postalCode: string;
    };
    aggregateRating?: {
          ratingValue?: number;
          ratingCount?: number;
    };
    review?: Array<{
        datePublished: number;
        description: string;
        reviewRating: {
          ratingValue: number;
        };
        author: {
          name: string;
        };
    }>;
}

export interface FbComment {
    name: string;
    date: string;
    text: string | null; // image / gif comment
    profileUrl: string | null;
    profilePicture: string | null;
    url: string;
}

export interface FbReview {
    date: string;
    title: string | null;
    text: string | null;
    attributes: string[];
    url: string | null;
    canonical: string | null;
}

export interface FbImage {
    link: string;
    image: string;
}

export interface FbPostLink {
    url: string;
    imageUrl: string | null;
    domain: string | null;
    title: string | null;
    text: string | null;
}

export interface FbPost {
    postDate: string;
    postText: string;
    postUrl: string;
    postStats: {
        reactions: number;
        shares: number;
        comments: number;
    };
    postImages: FbImage[];
    postLinks: FbPostLink[];
    name: string;
    logoUrl: string;
}

export interface FbService {
    title: string | null;
    text: string | null;
}

export interface FbPage {
    // hidden fields
   "#startedAt"?: string;
   "#finishedAt"?: string;
   "#url"?: string;
   "#ref"?: string;
   "#version"?: number;

    pageUrl: string;
    title: string;
    verified: boolean;
    messenger: string | null;
    checkins: string | null;
    likes: number;
    priceRange: string | null;
    categories: string[];
    info: string[];
    website: string | null;
    email: string | null;
    twitter: string | null;
    phone: string | null;
    transit: string | null;
    youtube: string | null;
    payment: string | null;
    impressum: string[];
    awards: string[];
    mission: string[];
    overview: string[];
    products: string[];
    instagram: string | null;
    address: {
        lat: number | null;
        lng: number | null;
        street: string | null;
        postalCode: string | null;
        region: string | null;
        city: string | null;
    };
    services?: FbService[];
    posts: FbPost[];
    reviews?: {
        average: number | null;
        count: number | null;
        reviews: FbReview[];
    };
 }
