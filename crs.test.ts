import { describe, expect, it } from 'vitest';
import { crsShort, crsSummary, makeCrs, toGrid, toWgs } from '../crs';
import type { CRSConfig } from '../types';

/** KTT 105.75° – dùng cho khu vực TP.HCM trong công trình mẫu. */
const HCM: CRSConfig = makeCrs(3, 105.75, 'TP.HCM');
/** Múi 6° kinh tuyến trục 108°. */
const ZONE6: CRSConfig = makeCrs(6, 108, 'Múi 49');

describe('makeCrs', () => {
  it('gán đúng hệ số tỷ lệ theo múi', () => {
    expect(makeCrs(3, 105.75, 'x').k).toBe(0.9999);
    expect(makeCrs(6, 108, 'x').k).toBe(0.9996);
    expect(makeCrs(3, 105, 'x')).toMatchObject({ mode: 3, lon0: 105, k: 0.9999, areaLabel: 'x' });
  });
});

describe('toGrid', () => {
  it('trên kinh tuyến trục thì Y gần 500 000 (x0), lệch vài trăm mét do dịch datum WGS-84 → VN-2000', () => {
    for (const crs of [HCM, ZONE6, makeCrs(3, 107.0, 'Đắk Lắk')]) {
      const g = toGrid(10.85, crs.lon0, crs);
      // Không đúng tuyệt đối 500 000: bộ 7 tham số làm dịch gốc tọa độ (~196 m ở TP.HCM).
      expect(Math.abs(g.y - 500_000)).toBeLessThan(400);
      // X là northing: phải dương và cỡ vĩ độ × ~110 km.
      expect(g.x).toBeGreaterThan(1_150_000);
      expect(g.x).toBeLessThan(1_250_000);
    }
  });

  it('Y tăng khi đi về phía đông, X tăng khi đi về phía bắc', () => {
    const base = toGrid(10.85, 106.77, HCM);
    const east = toGrid(10.85, 106.87, HCM);
    const north = toGrid(10.95, 106.77, HCM);
    // 0,1° ≈ 11 km trên lưới.
    expect(east.y - base.y).toBeGreaterThan(10_000);
    expect(north.x - base.x).toBeGreaterThan(11_000);
    // Thành phần vuông góc chỉ lệch vài chục mét (do dịch datum + độ cong múi).
    expect(Math.abs(east.x - base.x)).toBeLessThan(100);
    expect(Math.abs(north.y - base.y)).toBeLessThan(100);
  });

  it('0,1° kinh độ ở vĩ độ 10,85° tương đương ~10,9 km trên lưới (có hệ số k0 = 0,9999)', () => {
    const base = toGrid(10.85, 106.77, HCM);
    const east = toGrid(10.85, 106.87, HCM);
    const d = east.y - base.y;
    // 111320 m × cos(10,85°) × 0,1 × 0,9999 ≈ 10 932 m
    expect(d).toBeGreaterThan(10_900);
    expect(d).toBeLessThan(10_960);
  });

  it('múi 6° co ngắn hơn múi 3° tính từ kinh tuyến trục (k0 nhỏ hơn)', () => {
    const g3 = toGrid(10.85, 108.3, makeCrs(3, 108, 'x'));
    const g6 = toGrid(10.85, 108.3, ZONE6);
    expect(g6.y - 500_000).toBeLessThan(g3.y - 500_000);
  });
});

describe('toWgs', () => {
  it('đi vòng WGS-84 → VN-2000 → WGS-84 trả lại đúng tọa độ (sai số dưới 1 cm)', () => {
    const samples: Array<[number, number]> = [
      [10.8506, 106.7717],
      [21.0278, 105.8342],
      [16.0544, 108.2022],
      [8.6864, 106.6083],
    ];
    for (const [lat, lon] of samples) {
      const crs = makeCrs(3, Math.round(lon * 4) / 4, 'test');
      const g = toGrid(lat, lon, crs);
      const back = toWgs(g.x, g.y, crs);
      // 7 chữ số ≈ 1 cm; thực tế proj4 trả về sai số dưới 1 mm.
      expect(back.lat).toBeCloseTo(lat, 7);
      expect(back.lon).toBeCloseTo(lon, 7);
    }
  });

  it('điểm nằm trên kinh tuyến trục trả lại kinh độ đúng bằng lon0 (sai khác < 0,001°)', () => {
    const g = toGrid(10.85, 105.75, HCM);
    const { lat, lon } = toWgs(g.x, 500_000, HCM);
    expect(lat).toBeCloseTo(10.85, 3);
    expect(Math.abs(lon - 105.75)).toBeLessThan(0.002);
  });

  it('X/Y trong khoảng Việt Nam luôn cho vĩ độ/kinh độ nằm trong lãnh thổ', () => {
    const g = toGrid(10.8506, 106.7717, HCM);
    const { lat, lon } = toWgs(g.x, g.y, HCM);
    expect(lat).toBeGreaterThan(8);
    expect(lat).toBeLessThan(24);
    expect(lon).toBeGreaterThan(102);
    expect(lon).toBeLessThan(110);
  });
});

describe('mô tả hệ tọa độ', () => {
  it('luôn nêu rõ KTT và hệ số k0 để người đọc tệp biết gốc quy chiếu', () => {
    expect(crsSummary(HCM)).toBe('VN-2000 · 3° · KTT 105.75° · k0=0.9999');
    expect(crsShort(HCM)).toBe('KTT 105.75° · 3°');
    expect(crsSummary(ZONE6)).toBe('VN-2000 · 6° · KTT 108° · k0=0.9996');
    expect(crsSummary(makeCrs(3, 108.5, 'x'))).toContain('KTT 108.5°');
  });
});
