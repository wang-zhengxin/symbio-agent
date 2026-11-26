import { useEffect, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { isPagesMode, REPO_URL, workspaceHref } from '@/lib/links';

const ANCHOR_LINKS = [
  { label: '产品亮点', href: '#features' },
  { label: '交互演示', href: '#demo' },
  { label: '使用说明', href: '#guide' },
  { label: '常见问题', href: '#faq' },
];

export function SymbioMark() {
  return (
    <span
      className="grid grid-cols-2 grid-rows-2 place-content-center gap-[3px] w-[30px] h-[30px] rounded-[9px] bg-[#222120] shrink-0"
      aria-hidden="true"
    >
      <i className="w-[7px] h-[7px] rounded-[2px] bg-[#ece7e3]" />
      <i className="w-[6px] h-[6px] rounded-[2px] bg-[#c1b8b0] self-center justify-self-center" />
      <i className="w-[6px] h-[6px] rounded-[2px] bg-[#c1b8b0] self-center justify-self-center" />
      <i className="w-[7px] h-[7px] rounded-[2px] bg-[#ece7e3]" />
    </span>
  );
}

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <header className="sticky top-0 z-40 w-full">
      <div className="w-full max-w-[1320px] mx-auto px-5 sm:px-8 lg:px-12 pt-4">
        <div className="flex items-center justify-between h-[60px] px-4 sm:px-5 rounded-[18px] bg-white/75 backdrop-blur-[20px] border border-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_28px_-16px_rgba(37,36,35,0.18)]">
          <a href="#top" className="flex items-center gap-2.5 shrink-0">
            <SymbioMark />
            <div className="leading-tight">
              <span className="block text-[16px] font-bold tracking-[-0.02em] text-[#252423]">Symbio</span>
              <span className="block text-[10px] text-[#78716b]">人机共生 · 协同工作空间</span>
            </div>
          </a>

          <nav className="hidden md:flex items-center gap-7" aria-label="主页导航">
            {ANCHOR_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-[#5d5956] hover:text-[#252423] text-[14px] font-medium transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-2.5">
            <a
              href={isPagesMode ? REPO_URL : workspaceHref('#help')}
              target={isPagesMode ? '_blank' : undefined}
              rel={isPagesMode ? 'noreferrer' : undefined}
              className="inline-flex items-center justify-center h-[36px] px-3.5 rounded-[10px] text-[#5d5956] hover:text-[#252423] hover:bg-black/[0.04] text-[13px] font-medium transition-colors"
            >
              {isPagesMode ? 'GitHub 仓库' : '帮助中心'}
            </a>
            <a
              href={workspaceHref('#overview', '#guide')}
              className="inline-flex items-center gap-1.5 h-[36px] px-4 bg-[#242323] hover:bg-[#383634] rounded-[10px] text-[#f7f5f2] text-[13px] font-medium transition-colors"
            >
              {isPagesMode ? '本地快速部署' : '进入工作台'}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </div>

          <button
            type="button"
            className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-[10px] bg-white/80 border border-[#484239]/12 text-[#252423]"
            aria-label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="md:hidden mt-2 rounded-[16px] bg-white/95 backdrop-blur-[20px] border border-[#484239]/12 shadow-xl p-4">
            <div className="flex flex-col gap-1">
              {ANCHOR_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 rounded-[10px] text-[14px] font-medium text-[#252423] hover:bg-[#f1ede9]"
                >
                  {link.label}
                </a>
              ))}
              <a
                href={isPagesMode ? REPO_URL : workspaceHref('#help')}
                target={isPagesMode ? '_blank' : undefined}
                rel={isPagesMode ? 'noreferrer' : undefined}
                className="px-3 py-2.5 rounded-[10px] text-[14px] font-medium text-[#5d5956] hover:bg-[#f1ede9]"
              >
                {isPagesMode ? 'GitHub 仓库' : '帮助中心'}
              </a>
              <a
                href={workspaceHref('#overview', '#guide')}
                onClick={() => setMobileMenuOpen(false)}
                className="mt-2 inline-flex items-center justify-center gap-2 h-[42px] px-4 bg-[#242323] rounded-[10px] text-[#f7f5f2] text-[14px] font-medium"
              >
                {isPagesMode ? '本地快速部署' : '进入工作台'}
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
