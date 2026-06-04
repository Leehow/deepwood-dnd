import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import type { LinksFunction } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Theme } from "@radix-ui/themes";
import { getAppQueryClient } from "~/queries/queryClient";
import { installApiFetchInterceptor } from "~/utils/api-client";
import { ensureDictionaryInitialized } from "~/utils/i18n";
import { isAuthenticated } from "~/utils/auth";
import { MusicPlayer } from "~/components/MusicPlayer";
import { GlobalToastViewport } from "~/components/ui/Toast";
import { LocaleProvider, HtmlLangSync } from "~/i18n/LocaleProvider";
import { DEFAULT_LOCALE } from "~/i18n";
import "@radix-ui/themes/styles.css";
import "./styles/tailwind.css";

const ASSET_BASE = typeof import.meta.env?.BASE_URL === 'string'
  ? import.meta.env.BASE_URL.replace(/\/$/, '')
  : '';

export const links: LinksFunction = () => {
  return [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    {
      rel: "preconnect",
      href: "https://fonts.gstatic.com",
      crossOrigin: "anonymous",
    },
    {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600;700&display=swap",
    },
    // PWA Manifest
    { rel: "manifest", href: `${ASSET_BASE}/manifest.json` },
    // Favicons are rendered directly in <Layout> with suppressHydrationWarning
    // because some Chrome extensions (e.g. Codex) mutate favicon hrefs before
    // hydration. Going through <Links /> would surface that mutation as a prop
    // mismatch, abort hydration, and drop the SSR critical CSS.
  ];
};

// In dev the Vite client injects Tailwind via a <style> tag, and React Router
// emits SSR critical CSS as a <style data-react-router-critical-css>. Both of
// these are dropped when React falls back to client rendering (which Chrome
// extensions can trigger via DOM mutation on <html>/<body>/<head>). Keeping a
// persistent <link rel="stylesheet"> to the dev module URL guarantees Tailwind
// utilities remain available even after such a fallback. Prod builds emit a
// hashed CSS asset via the normal Vite build pipeline; we do NOT want a raw
// /app/... link in prod.
const IS_DEV = import.meta.env?.DEV === true;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="theme-color" content="#7c3aed" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Deepwood" />
        <Meta />
        <Links />
        {IS_DEV && (
          <link
            rel="stylesheet"
            href="/app/styles/tailwind.css?direct"
            data-dw-dev-tailwind-fallback=""
            suppressHydrationWarning
          />
        )}
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href={`${ASSET_BASE}/favicon.png`}
          suppressHydrationWarning
        />
        <link
          rel="icon"
          type="image/png"
          sizes="64x64"
          href={`${ASSET_BASE}/favicon-64x64.png`}
          suppressHydrationWarning
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href={`${ASSET_BASE}/apple-touch-icon.png`}
          suppressHydrationWarning
        />
      </head>
      <body className="overflow-x-hidden" suppressHydrationWarning>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [queryClient] = useState(() => getAppQueryClient());

  // Ensure API fetch is patched before child effects run
  if (typeof window !== "undefined") {
    installApiFetchInterceptor();
  }

  // Initialize translation dictionary on app mount
  useEffect(() => {
    ensureDictionaryInitialized();
  }, []);

  // 注册 Service Worker 用于图片缓存
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as typeof window & { __dwSwRegisterStarted?: boolean }).__dwSwRegisterStarted) return;
    if ("serviceWorker" in navigator) {
      (window as typeof window & { __dwSwRegisterStarted?: boolean }).__dwSwRegisterStarted = true;
      const basePath = typeof import.meta.env?.BASE_URL === 'string'
        ? import.meta.env.BASE_URL.replace(/\/$/, '')
        : '';
      navigator.serviceWorker
        .register(`${basePath}/sw.js`)
        .then((registration) => {
          console.log("[App] Service Worker 注册成功:", registration.scope);
        })
        .catch((error) => {
          console.error("[App] Service Worker 注册失败:", error);
        });
    }
  }, []);

  // Route protection - redirect to login if not authenticated
  useEffect(() => {
    if (typeof window === "undefined") return;

    const publicPaths = ["/login"];
    const isPublicPath = publicPaths.includes(location.pathname);

    if (!isPublicPath && !isAuthenticated()) {
      navigate("/login", { replace: true });
    }
  }, [location.pathname, navigate]);

  // PWA route persistence - save current route so we can restore it
  // when the OS kills the PWA process in the background
  useEffect(() => {
    if (typeof window === "undefined") return;
    // 标记本次会话已启动，用于区分 PWA 冷启动 vs 用户主动导航
    sessionStorage.setItem("dnd_app_loaded", "1");
    // 只记录战役房间路径，其他页面不需要 PWA 恢复
    if (location.pathname.startsWith("/campaign/")) {
      localStorage.setItem("dnd_last_route", location.pathname + location.search);
    }
  }, [location.pathname, location.search]);

  // Only show music player on login and home pages
  const showMusicPlayer = location.pathname === '/' || location.pathname === '/login';

  return (
    <Theme
      appearance="dark"
      accentColor="amber"
      grayColor="slate"
      radius="medium"
      scaling="100%"
    >
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <HtmlLangSync />
          <Outlet />
          <GlobalToastViewport />
          {showMusicPlayer && <MusicPlayer />}
        </LocaleProvider>
      </QueryClientProvider>
    </Theme>
  );
}
