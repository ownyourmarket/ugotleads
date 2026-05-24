"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

/**
 * Site-wide analytics + support widget loaders. Skipped on /embed/* so
 * the web-chat iframe doesn't accidentally render Crisp's widget inside
 * itself (two overlapping chat widgets = visual chaos) and so we don't
 * fire spurious PageView events from inside an embedded chat.
 *
 * Each tag is opt-in via its env var — leave unset to disable that tag
 * entirely (same as before; behavior on real pages is unchanged).
 */
export function AnalyticsScripts() {
  const pathname = usePathname();
  if (pathname?.startsWith("/embed/")) return null;

  return (
    <>
      {process.env.NEXT_PUBLIC_GTM_ID && (
        <Script id="gtm-script" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${process.env.NEXT_PUBLIC_GTM_ID}');`}
        </Script>
      )}
      {process.env.NEXT_PUBLIC_META_PIXEL_ID && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${process.env.NEXT_PUBLIC_META_PIXEL_ID}');fbq('track','PageView');`}
        </Script>
      )}
      {process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID && (
        <Script id="crisp-widget" strategy="afterInteractive">
          {`window.$crisp=[];window.CRISP_WEBSITE_ID="${process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID}";(function(){d=document;s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`}
        </Script>
      )}
    </>
  );
}
