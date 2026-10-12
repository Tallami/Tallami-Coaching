export type SocialLink = {
  label: "X" | "Twitch" | "YouTube" | "Instagram" | "TikTok";
  href: string;
};

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { label: "X", href: "https://x.com/tallami1" },
  { label: "Twitch", href: "https://twitch.tv/tallami" },
  { label: "YouTube", href: "https://youtube.com/@tallami1" },
  { label: "Instagram", href: "https://instagram.com/tallami1" },
  { label: "TikTok", href: "https://tiktok.com/@tallami" },
];
