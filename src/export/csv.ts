/**
 * Per-session CSV export (Section "Export"). Flat, one row per pitch, units named in
 * the header so a coach can open it in a spreadsheet without guessing. Nothing here
 * ever emits a spin field.
 */

import { toInches, toMph } from '@/domain/units';
import type { PitchRecord } from '@/domain/types';

const COLUMNS = [
  'sequence',
  'timestamp_iso',
  'labeled_type',
  'custom_type_name',
  'predicted_type',
  'prediction_confidence',
  'call_result',
  'call_confidence_band',
  'release_speed_mph',
  'plate_speed_mph',
  'time_to_plate_s',
  'horizontal_break_in',
  'vertical_break_in',
  'total_break_in',
  'break_is_approximate',
  'release_height_in',
  'release_side_in',
  'extension_in',
  'intended_type',
  'intended_target_x_in',
  'intended_target_y_in',
  'command_miss_in',
  'tracking_confidence',
  'camera_count',
] as const;

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  return escapeCsvField(String(value));
}

export function pitchRecordsToCsv(pitches: readonly PitchRecord[]): string {
  const ordered = [...pitches].sort((a, b) => a.sequence - b.sequence);
  const lines = [COLUMNS.join(',')];

  for (const p of ordered) {
    const row = [
      cell(p.sequence),
      cell(new Date(p.timestampMs).toISOString()),
      cell(p.labeledType),
      cell(p.customTypeName),
      cell(p.predictedType),
      cell(p.predictionConfidence !== null ? p.predictionConfidence.toFixed(3) : null),
      cell(p.call.result),
      cell(p.call.band),
      cell(toMph(p.measurements.releaseSpeedMps).toFixed(1)),
      cell(toMph(p.measurements.plateSpeedMps).toFixed(1)),
      cell(p.measurements.timeToPlateS.toFixed(3)),
      cell(toInches(p.measurements.horizontalBreakM).toFixed(1)),
      cell(toInches(p.measurements.verticalBreakM).toFixed(1)),
      cell(toInches(p.measurements.totalBreakM).toFixed(1)),
      cell(p.measurements.breakIsApproximate),
      cell(toInches(p.measurements.releaseHeightM).toFixed(1)),
      cell(toInches(p.measurements.releaseSideM).toFixed(1)),
      cell(toInches(p.measurements.extensionM).toFixed(1)),
      cell(p.intended?.type ?? null),
      cell(p.intended ? toInches(p.intended.target.x).toFixed(1) : null),
      cell(p.intended ? toInches(p.intended.target.y).toFixed(1) : null),
      cell(p.commandMissM !== undefined ? toInches(p.commandMissM).toFixed(1) : null),
      cell(p.trackingConfidence.toFixed(2)),
      cell(p.cameraCount),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\r\n');
}

export function downloadCsv(pitches: readonly PitchRecord[], filename: string): void {
  const csv = pitchRecordsToCsv(pitches);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
