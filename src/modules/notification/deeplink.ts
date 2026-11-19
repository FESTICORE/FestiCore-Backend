/** iOS Info.plist의 CFBundleURLSchemes와 `WidgetDeepLink`가 해석하는 스킴이다. */
export const DEEPLINK_SCHEME = 'festicore';

/** 알림 탭이 열 앱 화면. 푸시 payload의 `deeplink`는 이 값으로만 만든다. */
export type DeeplinkData =
  | { type: 'festival'; festivalId: string }
  | { type: 'set'; festivalId: string; setId: string };

export function buildDeeplink(data: DeeplinkData): string {
  const festival = `${DEEPLINK_SCHEME}://festival/${encodeURIComponent(data.festivalId)}`;
  switch (data.type) {
    case 'festival':
      return festival;
    case 'set':
      return `${festival}/set/${encodeURIComponent(data.setId)}`;
  }
}
