// 入口：先加载提醒按钮的后台处理（D-318，App 没开着时也要能用），再启动 Expo Router。
import './src/reminders/background';
import 'expo-router/entry';
