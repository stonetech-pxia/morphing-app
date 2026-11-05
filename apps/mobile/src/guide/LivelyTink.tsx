import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';

import { Icon } from '../renderer/Icon';

/**
 * 会动的 Tink 小锤子（D-447）：引导时右上角的 Tink 像在找人说话——向左看、向右看、回正，
 * 再原地蹦两下，停一会儿，循环；可以带一圈呼吸的光（高光）。只是动画，不写数据。
 */
export function LivelyTink({
  size,
  color,
  halo,
}: {
  size: number;
  color: string;
  /** 高光：身后一圈会呼吸的光（引导时用主色）。 */
  halo?: string;
}) {
  const [turn] = useState(() => new Animated.Value(0)); // -1 向左看，1 向右看
  const [hop] = useState(() => new Animated.Value(0)); // 0 落地，1 跳起
  const [glow] = useState(() => new Animated.Value(0)); // 光圈呼吸

  useEffect(() => {
    const ease = Easing.inOut(Easing.quad);
    const look = (to: number, duration: number) =>
      Animated.timing(turn, { toValue: to, duration, easing: ease, useNativeDriver: true });
    const jump = Animated.sequence([
      Animated.timing(hop, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(hop, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    const loop = Animated.loop(
      Animated.sequence([
        look(-1, 380),
        Animated.delay(420),
        look(1, 560),
        Animated.delay(420),
        look(0, 300),
        Animated.delay(150),
        jump,
        jump,
        Animated.delay(1400),
      ]),
    );
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 900, easing: ease, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 900, easing: ease, useNativeDriver: true }),
      ]),
    );
    loop.start();
    breathe.start();
    return () => {
      loop.stop();
      breathe.stop();
    };
  }, [turn, hop, glow]);

  const rotateY = turn.interpolate({ inputRange: [-1, 1], outputRange: ['-38deg', '38deg'] });
  const rotateZ = turn.interpolate({ inputRange: [-1, 1], outputRange: ['-10deg', '10deg'] });
  const translateY = hop.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const scaleY = hop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  const ring = size * 1.9;
  const tink = (
    <Animated.View
      testID="tink-lively"
      style={{
        transform: [{ perspective: 200 }, { translateY }, { rotateY }, { rotateZ }, { scaleY }],
      }}>
      <Icon name="tink" size={size} color={color} />
    </Animated.View>
  );
  if (!halo) return tink;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        testID="tink-halo"
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          backgroundColor: halo,
          opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.3] }),
          transform: [
            { scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) },
          ],
          boxShadow: `0px 0px 12px ${halo}`,
        }}
      />
      {tink}
    </View>
  );
}
