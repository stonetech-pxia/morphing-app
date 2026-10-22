import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { PackBridge, PackPageId } from './bridge';
import { PACK_BASE_URL } from './pages/common';
import { PDFVIEW_PAGE } from './pages/pdfview';
import type { PackStore } from './store';

// 扩展包运行环境：按需挂载隐藏的 WebView（每个扩展包一个页面），页面是我们随 App 发布的固定 HTML。

const PAGES: Partial<Record<PackPageId, string>> = { pdfview: PDFVIEW_PAGE };

export interface Packs {
  store: PackStore;
  bridge: PackBridge;
}

const PacksContext = createContext<Packs | null>(null);

/** 没有扩展包环境时（部分测试）返回 null：需要扩展包的步骤会提示无法准备。 */
export function usePacks(): Packs | null {
  return useContext(PacksContext);
}

export function PackHostProvider({ value, children }: { value: Packs; children: ReactNode }) {
  const active = useSyncExternalStore(value.bridge.subscribe, value.bridge.activePages);
  return (
    <PacksContext.Provider value={value}>
      {children}
      <View pointerEvents="none" style={styles.hidden}>
        {active.map((page) =>
          PAGES[page] ? (
            <WebView
              key={page}
              ref={(w) => value.bridge.attach(page, w)}
              source={{ html: PAGES[page]!, baseUrl: PACK_BASE_URL }}
              // 白名单设为全部，所有加载都交给下面的判断：只允许我们自己的页面，其他地址一律拒绝。
              // （不在白名单里的地址 react-native-webview 会交给系统打开，例如 Safari，所以不能靠白名单拦。）
              originWhitelist={['*']}
              onShouldStartLoadWithRequest={(r) =>
                r.url.startsWith(PACK_BASE_URL) ||
                r.url === 'about:blank' ||
                r.url.startsWith('blob:')
              }
              onMessage={(e) => void value.bridge.onMessage(page, e.nativeEvent.data)}
              onError={(e) => {
                if (__DEV__) console.warn(`[pack:${page}] load error`, e.nativeEvent.description);
              }}
              javaScriptEnabled
              allowFileAccess={false}
              setSupportMultipleWindows={false}
              style={styles.webview}
            />
          ) : null,
        )}
      </View>
    </PacksContext.Provider>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: 0, top: 0, width: 2, height: 2, opacity: 0.01 },
  webview: { width: 2, height: 2 },
});
