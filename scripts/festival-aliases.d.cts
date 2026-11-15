export declare const FESTIVAL_ALIASES: Readonly<Record<string, string>>;
export declare const HIDDEN_FESTIVAL_IDS: ReadonlySet<string>;
export declare function canonicalFestivalId(id: string): string;
export declare function isHiddenFestival(id: string): boolean;
