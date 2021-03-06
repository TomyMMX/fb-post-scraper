export type FbSection = 'home' | 'posts' | 'about' | 'reviews' | 'services';
export type FbLabel = 'POST' | 'PHOTO' | 'VIDEO';
export type FbCommentsMode = 'RANKED_THREADED' | 'RECENT_ACTIVITY' | 'RANKED_UNFILTERED';

export interface Schema {
    startUrl: string;
    proxyConfiguration?: any;
    language?: string;
    useStealth?: boolean;
    debugLog?: boolean;
    videoClickTimeout?: number;
}

export interface FbImage {
    link: string;
    imageUrl: string;
}

export interface FbVideo {
    postUrl: string;
    videoUrl: string;
}

export interface FbPostLink {
    url: string;
    thumbUrl: string | null;
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
    postVideos: FbVideo[];
    postLinks: FbPostLink[];
    name: string | null;
    logoUrl: string | null;
    videoPostUrl: string | null;
}
