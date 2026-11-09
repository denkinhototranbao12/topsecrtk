import { describe, expect, it } from 'vitest';
import { buildExport, toCsv, toDxf, toGeoJson, toKml, toTxt } from '../exporters';
import { makeCrs } from '../crs';
import type { Project, SurveyPoint } from '../types';

const project: Project = {
  id: 'p1',
  name: 'Thủ Đức – lô A',
  client: 'TOPSEC',
  note: '',
  crs: makeCrs(3, 105.75, 'TP.HCM'),
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const pts: SurveyPoint[] = [
  {
    id: 'pt1',
    projectId: 'p1',
    name: 'M1',
    code: 'LUOI',
    book: 'RTK đợt 1',
    note: 'góc thửa',
    lat: 10.8506,
    lon: 106.7717,
    x: 1200039.83,
    y: 611393.591,
    h: 10.5,
    hEll: 12.1,
    accuracy: 0.012,
    source: 'import',
    createdAt: 1_700_000_000_000,
  },
  {
    id: 'pt2',
    projectId: 'p1',
    name: 'Mốc 2, phía bắc',
    code: '',
    book: '',
    note: '',
    lat: 10.8512,
    lon: 106.7722,
    x: 1200105.5,
    y: 611450.25,
    h: null,
    hEll: null,
    accuracy: null,
    source: 'measure',
    createdAt: 1_700_000_500_000,
  },
];

const opts = { decimals: 3, includeHeader: true };

describe('CSV xuất cho Excel', () => {
  const csv = toCsv(pts, project, opts);
  // Bỏ BOM trước khi so từng dòng.
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n');

  it('có BOM UTF-8 và xuống dòng CRLF để Excel đọc đúng tiếng Việt', () => {
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('\r\n');
  });

  it('dòng đầu ghi rõ hệ tọa độ và công trình, không lẫn với tiêu đề cột', () => {
    expect(lines[0]).toBe('# He toa do: VN-2000 · 3° · KTT 105.75° · k0=0.9999 | Cong trinh: Thủ Đức – lô A');
    expect(lines[1]).toBe('Ten,Ma,X,Y,H,h_elip,B,L,SaiSo_m,Nguon,So_do,Thoi_gian,Ghi_chu');
  });

  it('số dùng dấu chấm thập phân, không phân cách nghìn, không bị đổi theo locale', () => {
    const row = lines[2].split(',');
    expect(row[2]).toBe('1200039.830');
    expect(row[3]).toBe('611393.591');
    expect(row[4]).toBe('10.500');
    expect(row[5]).toBe('12.100');
    expect(row[6]).toBe('10.85060000');
    expect(row[7]).toBe('106.77170000');
    expect(row[8]).toBe('0.0');
  });

  it('ô chứa dấu phẩy được bọc ngoặc kép để không vỡ cột', () => {
    expect(lines[3].startsWith('"Mốc 2, phía bắc",')).toBe(true);
    // Cột H, h_elip, SaiSo rỗng chứ không phải số 0 hay NaN.
    expect(lines[3]).toContain('1200105.500,611450.250,,,10.85120000,106.77220000,,');
    expect(lines[3]).toContain('Đo trên bản đồ');
    expect(lines[3]).not.toContain('NaN');
    expect(lines[3]).not.toContain('null');
  });

  it('bỏ dòng tiêu đề khi người dùng không muốn', () => {
    const noHead = toCsv(pts, project, { decimals: 2, includeHeader: false });
    expect(noHead).not.toContain('Ten,Ma,X');
    expect(noHead.split('\r\n')[1]).toContain('1200039.83');
    expect(noHead.split('\r\n')[1]).not.toContain('1200039.830');
  });
});

describe('TXT cho máy toàn đạc', () => {
  it('xuất Tên X Y H, cao độ thiếu ghi 0.000', () => {
    const rows = toTxt(pts, opts).split('\r\n');
    expect(rows[0]).toBe('M1 1200039.830 611393.591 10.500 LUOI');
    expect(rows[1]).toBe('Mốc 2, phía bắc 1200105.500 611450.250 0.000');
  });
});

describe('DXF', () => {
  const dxf = toDxf(pts, project, opts);

  it('khai báo đơn vị mét ($INSUNITS = 6) và phiên bản R2000', () => {
    expect(dxf).toContain('$ACADVER\r\n1\r\nAC1015');
    expect(dxf).toContain('$INSUNITS\r\n70\r\n6');
  });

  it('mỗi điểm có một POINT và một TEXT, đủ số lượng', () => {
    expect(dxf.match(/\r\n0\r\nPOINT\r\n/g)).toHaveLength(2);
    expect(dxf.match(/\r\n0\r\nTEXT\r\n/g)).toHaveLength(2);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('hoán vị đúng: DXF X = Đông (Y), DXF Y = Bắc (X)', () => {
    expect(dxf).toContain('10\r\n611393.591');
    expect(dxf).toContain('20\r\n1200039.830');
    expect(dxf).not.toContain('10\r\n1200039.830');
  });

  it('có layer DIEM/TEN và extents bao trọn dữ liệu', () => {
    expect(dxf).toContain('DIEM');
    expect(dxf).toContain('TEN');
    expect(dxf).toContain('$EXTMIN\r\n10\r\n611393.591');
    expect(dxf).toContain('$EXTMAX\r\n10\r\n611450.250');
  });
});

describe('GeoJSON và KML', () => {
  it('GeoJSON đặt [lon, lat, h_elip] đúng thứ tự và giữ X/Y trong properties', () => {
    const fc = JSON.parse(toGeoJson(pts, project));
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0].geometry.coordinates).toEqual([106.7717, 10.8506, 12.1]);
    expect(fc.features[0].properties.x).toBe(1200039.83);
    expect(fc.features[0].properties.ten).toBe('M1');
    // Điểm không có h_elip thì chỉ 2 chiều, không ghi NaN.
    expect(fc.features[1].geometry.coordinates).toHaveLength(2);
  });

  it('KML thoát ký tự XML và ghi rõ hệ tọa độ', () => {
    const kml = toKml([{ ...pts[0], name: 'A & B <1>' }], project);
    expect(kml).toContain('A &amp; B &lt;1&gt;');
    expect(kml).toContain('<coordinates>106.77170000,10.85060000,12.100</coordinates>');
    expect(kml).toContain('VN-2000');
  });
});

describe('buildExport', () => {
  it('trả đúng phần mở rộng và mime cho từng định dạng', () => {
    expect(buildExport('csv', pts, project, opts)).toMatchObject({ ext: 'csv' });
    expect(buildExport('dxf', pts, project, opts)).toMatchObject({ ext: 'dxf', mime: 'application/dxf' });
    expect(buildExport('backup', pts, project, opts)).toMatchObject({ ext: 'json' });
    expect(JSON.parse(buildExport('backup', pts, project, opts).text).app).toBe(
      'topsec-survey-workspace',
    );
  });
});
