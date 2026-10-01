import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Circle, Text as SvgText } from 'react-native-svg';
import type { ProgressionPoint } from '@eleven-deep/engine';
import { colors, spacing } from '../theme';

const HEIGHT = 150;
const PAD = { top: 10, right: 12, bottom: 20, left: 28 };
/** A season is about forty league weeks; close enough to space points by. */
const WEEKS_PER_SEASON = 40;

/**
 * How a player has come on: his ability as a line, and your scouts' read on his
 * ceiling as a band behind it. The band narrowing onto the line is what
 * learning about him looks like; the line climbing is him getting better.
 */
export function ProgressionChart({ points }: { points: readonly ProgressionPoint[] }) {
  const [width, setWidth] = useState(0);

  const xs = points.map(([season, week]) => season + week / WEEKS_PER_SEASON);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const values = points.flatMap(([, , ability, low, high]) => [ability, low, high]);
  const minY = Math.max(1, Math.floor((Math.min(...values) - 3) / 5) * 5);
  const maxY = Math.min(99, Math.ceil((Math.max(...values) + 3) / 5) * 5);

  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (value: number) => PAD.left + (maxX === minX ? plotW / 2 : ((value - minX) / (maxX - minX)) * plotW);
  const y = (value: number) => PAD.top + (1 - (value - minY) / Math.max(1, maxY - minY)) * plotH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(xs[i]!)},${y(p[2])}`).join(' ');
  const band =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(xs[i]!)},${y(p[4])}`).join(' ') +
    ' ' +
    [...points]
      .map((p, i) => ({ p, i }))
      .reverse()
      .map(({ p, i }) => `L${x(xs[i]!)},${y(p[3])}`)
      .join(' ') +
    ' Z';

  const seasons = [...new Set(points.map(([season]) => season))];
  const gridValues = [minY, Math.round((minY + maxY) / 2), maxY];
  const last = points[points.length - 1]!;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityLabel={describe(points)}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {gridValues.map((value) => (
            <React.Fragment key={value}>
              <Line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} stroke={colors.border} strokeWidth={1} />
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
              {`S${season}`}
            </SvgText>
          ))}
          <Path d={band} fill={colors.gold} fillOpacity={0.16} stroke="none" />
          <Path d={line} stroke={colors.accent} strokeWidth={2} fill="none" />
          <Circle cx={x(xs[xs.length - 1]!)} cy={y(last[2])} r={3.5} fill={colors.accent} />
        </Svg>
      ) : (
        <View style={{ height: HEIGHT }} />
      )}
      <View style={styles.legend}>
        <View style={[styles.swatch, { backgroundColor: colors.accent }]} />
        <Text style={styles.legendText}>Ability</Text>
        <View style={[styles.swatch, styles.band]} />
        <Text style={styles.legendText}>Could become (your scouts' range)</Text>
      </View>
    </View>
  );
}

function describe(points: readonly ProgressionPoint[]): string {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `Ability from ${first[2].toFixed(0)} to ${last[2].toFixed(0)}; could become ${last[3]} to ${last[4]}.`;
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  swatch: { width: 10, height: 3, borderRadius: 2 },
  band: { height: 8, backgroundColor: colors.gold, opacity: 0.35, marginLeft: spacing.sm },
  legendText: { color: colors.faint, fontSize: 10 },
});
