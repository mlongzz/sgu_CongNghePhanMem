const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectLanAddress } = require('../scripts/start-device.cjs');
const ip = address => ({ family: 'IPv4', internal: false, address });

test('device startup selects the current Wi-Fi and excludes VMware interfaces', () => {
  const selected = selectLanAddress({
    'VMware Network Adapter VMnet1': [ip('192.168.199.1')],
    Ethernet: [ip('10.10.10.4')],
    'Wi-Fi': [ip('172.20.10.4')],
  });
  assert.equal(selected.address, '172.20.10.4');
  assert.equal(selected.name, 'Wi-Fi');
});

test('an explicit device IP must belong to the computer rather than a stale network', () => {
  const interfaces = { 'Wi-Fi': [ip('172.20.10.4')] };
  assert.equal(selectLanAddress(interfaces, '172.20.10.4').address, '172.20.10.4');
  assert.throws(() => selectLanAddress(interfaces, '192.168.31.170'), /GUIDE_LAN_IP/);
  assert.throws(() => selectLanAddress(interfaces, 'IP-LAN-MAY-TINH'), /GUIDE_LAN_IP/);
});

test('ambiguous networks or a disconnected computer do not produce a misleading QR host', () => {
  assert.throws(() => selectLanAddress({ Ethernet: [ip('10.0.0.2')], Ethernet2: [ip('10.1.0.2')] }), /nhiều card mạng/);
  assert.throws(() => selectLanAddress({ 'Wi-Fi': [ip('169.254.1.2')] }), /Chưa tìm thấy/);
});
