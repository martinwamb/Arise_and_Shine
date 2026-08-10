import { describe, expect, test } from '@jest/globals';
import {
  classifyProtrackDevices,
  isTruckPlate,
  planProtrackTruckSync,
  plateFromDeviceName,
} from '../protrack-devices.js';

// Verbatim device names from the live Protrack account, so the parser is pinned to the
// naming the tracker company actually uses rather than an idealised format.
const LIVE_DEVICES = [
  { imei: '355139085340187', devicename: 'KDS 577P :0741129502' },
  { imei: '355139085250451', devicename: 'KDS 477P :0702698405' },
  { imei: '355139085368782', devicename: 'KDT 677J: 0748559792' },
  { imei: '355139085373360', devicename: 'KDT 677K: 0748575371' },
  { imei: '355139085679881', devicename: 'KDU 677P: 0300002006084' },
  { imei: '355139085772975', devicename: 'KDT 521K: 0300002006039' },
  { imei: '355139085766654', devicename: 'KDU 658S: 0300002035946' },
  { imei: '358069580242900', devicename: 'ZH8632:0300002035980' },
  { imei: '358069580239484', devicename: 'ZH8631 : 0300002035808' },
  { imei: '355139085924113', devicename: 'KDV 571U: 0300002008497' },
  { imei: '355139085928551', devicename: 'KDV 573U: 0300002008496' },
  { imei: '355139085925839', devicename: 'KDV 572U: IOT' },
  { imei: '355139086148613', devicename: 'KDX 602L: IOT' },
  { imei: '355139086151997', devicename: 'KDX 931G:0300002327981' },
  { imei: '355139086146310', devicename: 'KDX 930G: 0300002327986' },
];

describe('plateFromDeviceName', () => {
  test('strips the SIM suffix regardless of spacing around the colon', () => {
    expect(plateFromDeviceName('KDS 577P :0741129502')).toBe('KDS 577P');
    expect(plateFromDeviceName('KDT 677J: 0748559792')).toBe('KDT 677J');
    expect(plateFromDeviceName('KDX 931G:0300002327981')).toBe('KDX 931G');
  });

  test('handles a placeholder tail instead of a SIM number', () => {
    expect(plateFromDeviceName('KDV 572U: IOT')).toBe('KDV 572U');
  });

  test('collapses stray whitespace and uppercases', () => {
    expect(plateFromDeviceName('  kdx   602l : IOT ')).toBe('KDX 602L');
  });

  test('accepts a bare plate with no colon', () => {
    expect(plateFromDeviceName('KDH 155L')).toBe('KDH 155L');
  });

  test('returns empty for junk input', () => {
    expect(plateFromDeviceName('')).toBe('');
    expect(plateFromDeviceName(null)).toBe('');
    expect(plateFromDeviceName(undefined)).toBe('');
  });
});

describe('isTruckPlate', () => {
  test('accepts Kenyan truck plates with or without the space', () => {
    expect(isTruckPlate('KDS 477P')).toBe(true);
    expect(isTruckPlate('KDS477P')).toBe(true);
    expect(isTruckPlate('KDH 155L')).toBe(true);
  });

  test('rejects Protrack trailer units', () => {
    expect(isTruckPlate('ZH8631')).toBe(false);
    expect(isTruckPlate('ZH 8632')).toBe(false);
  });

  test('rejects Cartrack trailer registrations', () => {
    expect(isTruckPlate('KDP177T-SVR')).toBe(false);
    expect(isTruckPlate('KDQ277MS1')).toBe(false);
    expect(isTruckPlate('KDQ377MS1')).toBe(false);
  });

  test('rejects empty and malformed values', () => {
    expect(isTruckPlate('')).toBe(false);
    expect(isTruckPlate(null)).toBe(false);
    expect(isTruckPlate('IOT')).toBe(false);
    expect(isTruckPlate('KDS 477')).toBe(false);
  });
});

describe('classifyProtrackDevices', () => {
  test('keeps the 13 trucks and skips the 2 trailer units on the live account', () => {
    const { trucks, skipped } = classifyProtrackDevices(LIVE_DEVICES);
    expect(trucks).toHaveLength(13);
    expect(skipped).toHaveLength(2);
    expect(skipped.map((entry) => entry.plate).sort()).toEqual(['ZH8631', 'ZH8632']);
  });

  test('pairs each truck with its IMEI', () => {
    const { trucks } = classifyProtrackDevices(LIVE_DEVICES);
    const byPlate = Object.fromEntries(trucks.map((entry) => [entry.plate, entry.imei]));
    expect(byPlate['KDX 602L']).toBe('355139086148613');
    expect(byPlate['KDV 572U']).toBe('355139085925839');
  });

  test('skips a device with no IMEI', () => {
    const { trucks, skipped } = classifyProtrackDevices([{ devicename: 'KDH 155L: 0700000000' }]);
    expect(trucks).toHaveLength(0);
    expect(skipped[0].reason).toBe('missing imei');
  });

  test('tolerates a non-array payload', () => {
    expect(classifyProtrackDevices(null).trucks).toEqual([]);
    expect(classifyProtrackDevices(undefined).skipped).toEqual([]);
  });
});

describe('planProtrackTruckSync', () => {
  // The 13 Protrack trucks as they exist in production: plates already correct, no IMEI stored.
  const EXISTING_TRUCKS = [
    'KDS 477P', 'KDS 577P', 'KDT 521K', 'KDT 677J', 'KDT 677K', 'KDU 658S', 'KDU 677P',
    'KDV 571U', 'KDV 572U', 'KDV 573U', 'KDX 602L', 'KDX 930G', 'KDX 931G',
  ].map((plate) => ({ id: plate.replace(/\s/g, ''), plate, protrackImei: null }));

  test('links every live device to its existing truck and creates nothing', () => {
    const { trucks: candidates } = classifyProtrackDevices(LIVE_DEVICES);
    const { created, backfilled, unchanged } = planProtrackTruckSync(EXISTING_TRUCKS, candidates);
    expect(created).toEqual([]);
    expect(backfilled).toHaveLength(13);
    expect(unchanged).toEqual([]);
  });

  test('is a no-op once the trackers are linked', () => {
    const { trucks: candidates } = classifyProtrackDevices(LIVE_DEVICES);
    const linked = EXISTING_TRUCKS.map((truck) => ({
      ...truck,
      protrackImei: candidates.find((c) => c.plate === truck.plate).imei,
    }));
    const { created, backfilled, unchanged } = planProtrackTruckSync(linked, candidates);
    expect(created).toEqual([]);
    expect(backfilled).toEqual([]);
    expect(unchanged).toHaveLength(13);
  });

  test('creates a truck for a plate that is not in the fleet yet', () => {
    const { created, backfilled } = planProtrackTruckSync(EXISTING_TRUCKS, [
      { plate: 'KDY 123A', imei: '355139086999999' },
    ]);
    expect(backfilled).toEqual([]);
    expect(created).toEqual([
      { truckId: 'KDY123A', plate: 'KDY 123A', imei: '355139086999999' },
    ]);
  });

  // KDH 155L is added by hand before its provider is known. When a tracker is eventually
  // fitted, the sync must adopt the existing row rather than create a duplicate.
  test('adopts a manually added untracked truck instead of duplicating it', () => {
    const trucks = [...EXISTING_TRUCKS, { id: 'KDH155L', plate: 'KDH 155L', protrackImei: null }];
    const { created, backfilled } = planProtrackTruckSync(trucks, [
      { plate: 'KDH 155L', imei: '355139086111111' },
    ]);
    expect(created).toEqual([]);
    expect(backfilled).toEqual([
      { truckId: 'KDH155L', plate: 'KDH 155L', imei: '355139086111111', previousImei: null },
    ]);
  });

  test('follows a replaced device on the same truck', () => {
    const trucks = [{ id: 'KDS477P', plate: 'KDS 477P', protrackImei: '355139085249875' }];
    const { created, backfilled } = planProtrackTruckSync(trucks, [
      { plate: 'KDS 477P', imei: '355139085250451' },
    ]);
    expect(created).toEqual([]);
    expect(backfilled[0]).toEqual({
      truckId: 'KDS477P',
      plate: 'KDS 477P',
      imei: '355139085250451',
      previousImei: '355139085249875',
    });
  });

  test('matches on IMEI even after the plate was corrected', () => {
    const trucks = [{ id: 'KDX602L', plate: 'KDX 602L', protrackImei: '355139086148613' }];
    const { created, backfilled, unchanged } = planProtrackTruckSync(trucks, [
      { plate: 'KDX 602I', imei: '355139086148613' },
    ]);
    expect(created).toEqual([]);
    expect(backfilled).toEqual([]);
    expect(unchanged).toHaveLength(1);
  });

  test('does not create the same truck twice when two devices share a plate', () => {
    const { created, backfilled } = planProtrackTruckSync([], [
      { plate: 'KDY 123A', imei: '111' },
      { plate: 'KDY 123A', imei: '222' },
    ]);
    expect(created).toHaveLength(1);
    expect(backfilled).toHaveLength(1);
    expect(backfilled[0].previousImei).toBe('111');
  });

  test('starts from an empty fleet without blowing up', () => {
    const { trucks: candidates } = classifyProtrackDevices(LIVE_DEVICES);
    const { created } = planProtrackTruckSync([], candidates);
    expect(created).toHaveLength(13);
    expect(created.map((item) => item.truckId)).toContain('KDX602L');
  });
});
