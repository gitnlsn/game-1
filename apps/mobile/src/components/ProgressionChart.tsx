import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import type { ProgressionPoint } from '@eleven-deep/engine';
import { colors, radius, spacing } from '../theme';

const HEIGHT = 130;
const PAD = { top: 10, right: 12, bottom: 20, left: 28 };
/** A season is about forty league weeks; close enough to space points by. */
const WEEKS_PER_SEASON = 40;
/**
 * The narrowest the ability axis goes. Any tighter and a fraction of a point of
 * noise would look like a collapse.
 */
const MIN_SPAN = 6;

/**
 * How a player has come on. Two separate pictures, because they are two
 * separate questions on two very different scales: the line is how good he is,
 * drawn tight enough that a season's growth shows; the strip under it is how
 * good your scouts think he could become, and how much that read has narrowed.
 */
export function ProgressionChart({ points }: { points: readonly ProgressionPoint[] }) {
  return (
    <View>
      <AbilityLine points={points} />
      <CeilingStrip points={points} />
    </View>
  );
}

function AbilityLine({ points }: { points: readonly ProgressionPoint[] }) {
  const [width, setWidth] = useState(0);

  const xs = points.map(([season, week]) => season + week / WEEKS_PER_SEASON);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const abilities = points.map((p) => p[2]);
  const mid = (Math.min(...abilities) + Math.max(...abilities)) / 2;
  const span = Math.max(MIN_SPAN, Math.max(...abilities) - Math.min(...abilities) + 2);
  const minY = Math.floor(mid - span / 2);
  const maxY = Math.ceil(mid + span / 2);

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (value: number) =>
    PAD.left + (maxX === minX ? plotW / 2 : ((value - minX) / (maxX - minX)) * plotW);
  const y = (value: number) => PAD.top + (1 - (value - minY) / Math.max(1, maxY - minY)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(xs[i]!)},${y(p[2])}`).join(' ');
  const seasons = [...new Set(points.map(([season]) => season))];
  const last = points[points.length - 1]!;
  const first = points[0]!;

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityLabel={`Ability from ${first[2].toFixed(1)} to ${last[2].toFixed(1)}.`}
    >
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {[minY, maxY].map((value) => (
            <React.Fragment key={value}>
              <Line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(value)}
                y2={y(value)}
                stroke={colors.border}
                strokeWidth={1}
              />
              <SvgText x={PAD.left - 6} y={y(value) + 3} fontSize={9} fill={colors.faint} textAnchor="end">
                {value}
              </SvgText>
            </React.Fragment>
          ))}
          {seasons.map((season) => (
            <SvgText
              key={season}
              x={x(Math.max(minX, season))}
              y={HEIGHT - 6}
              fontSize={9}
              fill={colors.faint}
              textAnchor={season === seasons[0] ? 'start' : 'middle'}
            >
              {`Season ${season}`}
            </SvgText>
          ))}
          <Path d={line} stroke={colors.accent} strokeWidth={2} fill="none" />
          <Circle cx={x(xs[xs.length - 1]!)} cy={y(last[2])} r={3.5} fill={colors.accent} />
        </Svg>
      ) : (
        <View style={{ height: HEIGHT }} />
      )}
    </View>
  );
}

/**
 * The scouted range on a fixed scale from his current level up, so a range that
 * has closed in on him looks like it. The first range you had on him is drawn
 * faintly behind the current one.
 */
function CeilingStrip({ points }: { points: readonly ProgressionPoint[] }) {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const floor = Math.floor(Math.min(first[2], last[2], first[3]) / 5) * 5;
  const top = Math.min(99, Math.ceil(Math.max(first[4], last[4]) / 5) * 5);
  const pct = (value: number) => `${((value - floor) / Math.max(1, top - floor)) * 100}%` as const;
  const narrowed = first[4] - first[3] - (last[4] - last[3]);

  return (
    <View style={styles.strip} accessibilityLabel={`Could become ${last[3]} to ${last[4]}.`}>
      <View style={styles.stripHeader}>
        <Text style={styles.stripLabel}>Could become</Text>
        <Text style={styles.stripValue}>
          {last[3] === last[4] ? last[4] : `${last[3]}–${last[4]}`}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.range, styles.rangeThen, { left: pct(first[3]), width: pct(floor + first[4] - first[3]) }]} />
        <View style={[styles.range, { left: pct(last[3]), width: pct(floor + Math.max(1, last[4] - last[3])) }]} />
        <View style={[styles.now, { left: pct(last[2]) }]} />
      </View>
      <View style={styles.scale}>
        <Text style={styles.scaleText}>{floor}</Text>
        <Text style={styles.scaleText}>{top}</Text>
      </View>
      <Text style={styles.stripNote}>
        {narrowed >= 2
          ? `Your read on him has narrowed from ${first[3]}–${first[4]}. Scouting and minutes are what narrow it.`
          : 'Scouting him, or playing him, is what narrows this range.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { marginTop: spacing.sm },
  stripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  stripLabel: { color: colors.faint, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  stripValue: { color: colors.gold, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  track: {
    height: 12,
    marginTop: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  range: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.gold, opacity: 0.85, borderRadius: radius.sm },
  rangeThen: { opacity: 0.2 },
  now: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1, backgroundColor: colors.accent },
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  scaleText: { color: colors.faint, fontSize: 9, fontVariant: ['tabular-nums'] },
  stripNote: { color: colors.faint, fontSize: 11, marginTop: spacing.xs, lineHeight: 16 },
});
