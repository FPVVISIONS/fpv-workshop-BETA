// Test-only resolver: maps the Capacitor BLE plugin to mock-ble.mjs.
export async function resolve(specifier, context, next) {
  if (specifier === '@capacitor-community/bluetooth-le') {
    return { url: new URL('./mock-ble.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
