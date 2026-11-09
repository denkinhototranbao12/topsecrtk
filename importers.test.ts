import { describe, expect, it } from 'vitest';
import { parseImport } from '../importers';
import { toBackup, toGeoJson } from '../exporters';
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

function point(over: Partial<SurveyPoint> = {}): SurveyPoint {
  return {
    id: 'pt1',
    projectId: 'p1',
    name: 'M1',
    code: 'LUOI',
    book: 'RTK đợt 1',
    note: '',
    lat: 10.8506,
    lon: 106.7717,
    x: 1200039.83,
    y: 611393.591,
    h: 10.5,
    hEll: 12.1,
    accuracy: 0.012,
    source: 'import',
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

describe('CSV có tiêu đề tiếng Việt kèm đơn vị, số kiểu Việt Nam', () => {
  const text = [
    'Tên điểm,Tọa độ X (m),Tọa độ Y (m),Cao độ (m),Mã điểm',
    'M1,"1.200.039,830","611.393,591","10,5",LUOI',
    'Mốc 2,"1.200.048,120","611.401,770","10,6",LUOI',
  ].join('\r\n');

  it('nhận đúng cột dù tiêu đề có “Tọa độ … (m)” và đọc đúng số', () => {
    const r = parseImport(text, 'so-do.csv');
    expect(r.points).toHaveLength(2);
    expect(r.skipped).toBe(0);
    expect(r.kind).toBe('grid');
    expect(r.format).toBe('csv');
    expect(r.points[0]).toMatchObject({ name: 'M1', code: 'LUOI' });
    expect(r.points[0].x).toBeCloseTo(1200039.83, 3);
    expect(r.points[0].y).toBeCloseTo(611393.591, 3);
    expect(r.points[0].h).toBeCloseTo(10.5, 3);
    expect(r.warnings).toHaveLength(0);
  });

  it('giữ nguyên dấu tiếng Việt trong tên điểm', () => {
    expect(parseImport(text, 'so-do.csv').points[1].name).toBe('Mốc 2');
  });
});

describe('tệp không có tiêu đề', () => {
  it('bỏ cột STT đứng trước, không lấy số thứ tự làm tọa độ', () => {
    const r = parseImport(
      ['1 M1 1200039.830 611393.591 10.500', '2 M2 1200048.120 611401.770 10.600'].join('\n'),
      'xuat-may.txt',
    );
    expect(r.points).toHaveLength(2);
    expect(r.points[0]).toMatchObject({ name: 'M1' });
    expect(r.points[0].x).toBeCloseTo(1200039.83, 3);
    expect(r.points[0].y).toBeCloseTo(611393.591, 3);
    expect(r.points[0].h).toBeCloseTo(10.5, 3);
    expect(r.kind).toBe('grid');
  });

  it('tự đảo X/Y khi cột Đông (Y) đứng trước cột Bắc (X)', () => {
    const r = parseImport(['A1 611393.591 1200039.830 10.5', 'A2 611401.770 1200048.120 10.6'].join('\n'));
    expect(r.points[0].x).toBeCloseTo(1200039.83, 3);
    expect(r.points[0].y).toBeCloseTo(611393.591, 3);
  });

  it('nhận tọa độ B/L khi giá trị nằm trong khoảng độ', () => {
    const r = parseImport(['P1 10.850612 106.771735 12.1', 'P2 10.851 106.772 12.2'].join('\n'));
    expect(r.kind).toBe('wgs');
    expect(r.points[0].lat).toBeCloseTo(10.850612, 6);
    expect(r.points[0].lon).toBeCloseTo(106.771735, 6);
    expect(r.points[0].x).toBeNull();
  });
});

describe('dấu phân cách và bảng mã', () => {
  it('đọc được bảng copy trực tiếp từ Excel (tab) có tiếng Việt', () => {
    const r = parseImport(
      ['Tên điểm\tX\tY\tGhi chú', 'Mốc 1\t1200039.83\t611393.59\tGóc thửa'].join('\n'),
    );
    expect(r.points).toHaveLength(1);
    expect(r.points[0].name).toBe('Mốc 1');
    expect(r.points[0].code).toBe('');
    expect(r.points[0].x).toBeCloseTo(1200039.83, 3);
  });

  it('đọc được dấu chấm phẩy kèm dấu phẩy thập phân', () => {
    const r = parseImport(['Ten;X;Y;H', 'M1;1200039,83;611393,59;10,5'].join('\n'));
    expect(r.points[0].x).toBeCloseTo(1200039.83, 3);
    expect(r.points[0].y).toBeCloseTo(611393.59, 3);
    expect(r.points[0].h).toBeCloseTo(10.5, 3);
  });

  it('đọc được CSV bọc ngoặc kép, tên điểm có dấu phẩy', () => {
    const r = parseImport(
      [
        '"Tên điểm";"Tọa độ X (m)";"Tọa độ Y (m)"',
        '"Mốc A, phía bắc";"1.200.039,830";"611.393,591"',
      ].join('\r\n'),
    );
    expect(r.points).toHaveLength(1);
    expect(r.points[0].name).toBe('Mốc A, phía bắc');
    expect(r.points[0].x).toBeCloseTo(1200039.83, 3);
    expect(r.warnings.join(' ')).not.toContain('bỏ qua vì thiếu');
  });

  it('bỏ qua BOM và dòng chú thích bắt đầu bằng #', () => {
    const r = parseImport('\uFEFF# He toa do: VN-2000\nTen,X,Y\nM1,1200039.83,611393.59');
    expect(r.points).toHaveLength(1);
  });
});

describe('cảnh báo dữ liệu nghi vấn', () => {
  it('đếm dòng bị bỏ khi dòng không có cặp tọa độ', () => {
    const r = parseImport(['Ten,X,Y', 'M1,1200039.83,611393.59', 'M2,,', 'M3,abc,xyz'].join('\n'));
    expect(r.points).toHaveLength(1);
    expect(r.skipped).toBe(2);
    expect(r.warnings.join(' ')).toContain('2 dòng bị bỏ qua');
  });

  it('cảnh báo khi X/Y ngoài khoảng thường gặp của VN-2000', () => {
    const r = parseImport(['Ten,X,Y', 'M1,1000.5,2000.75'].join('\n'));
    expect(r.points).toHaveLength(1);
    expect(r.warnings.join(' ')).toContain('ngoài khoảng thường gặp của VN-2000');
  });

  it('cảnh báo khi tệp không có điểm nào dùng được', () => {
    const r = parseImport(['Ten,X,Y', 'M1,,', 'M2,,'].join('\n'));
    expect(r.points).toHaveLength(0);
    expect(r.warnings.join(' ')).toContain('Không đọc được điểm nào');
  });
});

describe('định dạng khác', () => {
  it('đọc GeoJSON FeatureCollection', () => {
    const text = toGeoJson([point(), point({ id: 'pt2', name: 'Mốc 2' })], project);
    const r = parseImport(text, 'diem.geojson');
    expect(r.format).toBe('geojson');
    expect(r.points).toHaveLength(2);
    expect(r.points[1].name).toBe('Mốc 2');
    expect(r.points[0].lat).toBeCloseTo(10.8506, 6);
    expect(r.points[0].y).toBeCloseTo(611393.591, 3);
  });

  it('nhận bản sao lưu TOPSEC và giữ nguyên hệ tọa độ gốc', () => {
    const r = parseImport(toBackup([point()], project), 'backup.json');
    expect(r.format).toBe('backup');
    expect(r.backupProjectName).toBe('Thủ Đức – lô A');
    expect(r.backupCrs).toMatchObject({ lon0: 105.75, k: 0.9999 });
    expect(r.points[0].x).toBeCloseTo(1200039.83, 3);
    expect(r.warnings[0]).toContain('bản sao lưu TOPSEC');
  });

  it('báo lỗi rõ ràng với tệp rỗng', () => {
    expect(() => parseImport('   ', 'rong.csv')).toThrow('Nội dung tệp rỗng');
  });
});
