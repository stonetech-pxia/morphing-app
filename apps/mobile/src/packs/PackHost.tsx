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
              originWhitelist={[PACK_BASE_URL, 'about:blank']}
              // 页面不能跳转到任何别的地址。
              onShouldStartLoadWithRequest={(r) =>
                r.url.startsWith(PACK_BASE_URL) || r.url === 'about:blank'
              }
              onMessage={(e) => void value.bridge.onMessage(page, e.nativeEvent.data)}
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
