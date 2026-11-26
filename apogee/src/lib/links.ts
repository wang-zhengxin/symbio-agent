export const isPagesMode = import.meta.env.VITE_PAGES_MODE === '1';
export const REPO_URL = 'https://github.com/wang-zhengxin/symbio-agent';

export function workspaceHref(hash: string, pagesFallback = '#guide'): string {
  return isPagesMode ? pagesFallback : `/office${hash}`;
}
