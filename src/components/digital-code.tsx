import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import qrcode from 'qrcode-generator';

// ─── Code 128 Barcode Pattern Encoder ─────────────────────────────────────────

const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

function encodeCode128B(text: string): boolean[] {
  try {
    if (!text || typeof text !== 'string') return [];
    const codes: number[] = [104]; // START B
    let checkSum = 104;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i) - 32;
      if (code >= 0 && code <= 95) {
        codes.push(code);
        checkSum += code * (i + 1);
      }
    }

    codes.push(Math.max(0, checkSum % 103));
    codes.push(106); // STOP

    const bits: boolean[] = [];
    for (let q = 0; q < 10; q++) bits.push(false);

    for (const c of codes) {
      const pattern = CODE128_PATTERNS[c] || '212222';
      let isBar = true;
      for (let j = 0; j < (pattern?.length ?? 0); j++) {
        const width = parseInt(pattern[j], 10) || 1;
        for (let w = 0; w < width; w++) {
          bits.push(isBar);
        }
        isBar = !isBar;
      }
    }

    for (let q = 0; q < 10; q++) bits.push(false);
    return bits;
  } catch (err) {
    console.warn('Failed to encode barcode:', err);
    return [];
  }
}

// ─── QR Code Matrix Generator ───────────────────────────────────────────────

/**
 * Encodes a real, scannable QR code.
 *
 * The previous implementation drew the three finder patterns and the timing
 * lines, then filled every data module with noise seeded by a hash of the
 * payload. It looked convincing — right shape, plausible density — but carried
 * no data, no Reed-Solomon correction, no format information and no mask, so a
 * scanner found the finders, failed to read the format block and rejected it.
 * That is not a cosmetic bug: someone holding this at a gate is turned away
 * while the original photo in the same item would have worked.
 *
 * Error correction level M: the usual choice for tickets, and it survives the
 * glare and partial obstruction of a screen being scanned at an angle.
 */
function generateQrMatrix(text: string): boolean[][] {
  try {
    if (!text || typeof text !== 'string') return [];
    // Version 0 lets the library pick the smallest version that fits the data.
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const matrix: boolean[][] = [];
    for (let r = 0; r < count; r += 1) {
      const row: boolean[] = [];
      for (let c = 0; c < count; c += 1) row.push(qr.isDark(r, c));
      matrix.push(row);
    }
    return matrix;
  } catch (err) {
    // Returning empty renders nothing rather than something unscannable — a
    // missing code sends someone to their original photo; a fake one does not.
    console.warn('Failed to generate QR matrix:', err);
    return [];
  }
}

// ─── Component Props ────────────────────────────────────────────────────────

type DigitalCodeProps = {
  payload: string;
  format?: 'QR_CODE' | 'CODE_128' | 'EAN_13' | 'CODE_39' | 'PDF417' | 'OTHER';
  label?: string;
};

export function DigitalCode({ payload, format = 'CODE_128', label }: DigitalCodeProps) {
  const theme = useTheme();
  const [fullscreen, setFullscreen] = useState(false);

  const isQr = format === 'QR_CODE' || payload.startsWith('http://') || payload.startsWith('https://');

  const barcodeBits = useMemo(() => {
    if (isQr) return [];
    return encodeCode128B(payload);
  }, [payload, isQr]);

  const qrMatrix = useMemo(() => {
    if (!isQr) return [];
    return generateQrMatrix(payload);
  }, [payload, isQr]);

  /**
   * Cell size is derived, not fixed.
   *
   * The module count grows with the payload — a longer ticket reference needs a
   * higher QR version — so the old fixed 6pt/10pt cells silently overflowed
   * their container once a code went past version 1. Dividing a target width by
   * the actual module count keeps every version the same physical size.
   */
  const qrModules = qrMatrix.length || 1;
  const cardCell = Math.max(3, Math.floor(170 / qrModules));
  const modalCell = Math.max(5, Math.floor(280 / qrModules));

  return (
    <>
      <Pressable
        onPress={() => setFullscreen(true)}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: '#FFFFFF',
            borderColor: theme.separator,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.headerTitleRow}>
            <Ionicons
              name={isQr ? 'qr-code-outline' : 'barcode-outline'}
              size={18}
              color="#111827"
            />
            <ThemedText style={styles.cardTitle}>
              {isQr ? 'Digital QR Code' : 'Digital Barcode'}
            </ThemedText>
          </View>
          <View style={styles.tapToEnlarge}>
            <Ionicons name="expand-outline" size={14} color="#6B7280" />
            <ThemedText style={styles.tapText}>Tap to scan</ThemedText>
          </View>
        </View>

        {isQr ? (
          <View style={[styles.qrContainer, { padding: cardCell * 4 }]}>
            {qrMatrix.map((row, r) => (
              <View key={`row-${r}`} style={styles.qrRow}>
                {row.map((active, c) => (
                  <View
                    key={`col-${c}`}
                    style={[
                      { width: cardCell, height: cardCell },
                      { backgroundColor: active ? '#000000' : '#FFFFFF' },
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.barcodeContainer}>
            <View style={styles.barcodeBars}>
              {barcodeBits.map((active, idx) => (
                <View
                  key={`bar-${idx}`}
                  style={[
                    styles.barcodeBar,
                    { backgroundColor: active ? '#000000' : '#FFFFFF' },
                  ]}
                />
              ))}
            </View>
            <ThemedText style={styles.barcodeText} numberOfLines={1}>
              {label || payload}
            </ThemedText>
          </View>
        )}
      </Pressable>

      {/* Fullscreen Magnified Scanner Modal */}
      <Modal visible={fullscreen} transparent animationType="fade" onRequestClose={() => setFullscreen(false)}>
        <SafeAreaView style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Pressable onPress={() => setFullscreen(false)} style={styles.closeButton}>
              <Ionicons name="close-circle" size={32} color="#4B5563" />
            </Pressable>

            <ThemedText style={styles.modalTitle}>
              {isQr ? 'Scan QR Code' : 'Scan Barcode'}
            </ThemedText>
            <ThemedText style={styles.modalSubtitle}>
              Hold your screen up to the scanner kiosk or cash register.
            </ThemedText>

            <View style={styles.modalCodeBox}>
              {isQr ? (
                <View style={[styles.modalQrContainer, { padding: modalCell * 4 }]}>
                  {qrMatrix.map((row, r) => (
                    <View key={`modal-row-${r}`} style={styles.modalQrRow}>
                      {row.map((active, c) => (
                        <View
                          key={`modal-col-${c}`}
                          style={[
                            { width: modalCell, height: modalCell },
                            { backgroundColor: active ? '#000000' : '#FFFFFF' },
                          ]}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.modalBarcodeContainer}>
                  <View style={styles.modalBarcodeBars}>
                    {barcodeBits.map((active, idx) => (
                      <View
                        key={`modal-bar-${idx}`}
                        style={[
                          styles.modalBarcodeBar,
                          { backgroundColor: active ? '#000000' : '#FFFFFF' },
                        ]}
                      />
                    ))}
                  </View>
                  <ThemedText style={styles.modalBarcodeNumber}>
                    {label || payload}
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.four,
    alignItems: 'center',
    marginVertical: Spacing.two,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  tapToEnlarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tapText: {
    fontSize: 12,
    color: '#6B7280',
  },
  barcodeContainer: {
    alignItems: 'center',
    width: '100%',
    paddingVertical: Spacing.two,
  },
  barcodeBars: {
    flexDirection: 'row',
    height: 64,
    alignItems: 'stretch',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 280,
  },
  barcodeBar: {
    flex: 1,
  },
  barcodeText: {
    marginTop: Spacing.two,
    fontSize: 13,
    letterSpacing: 2,
    fontFamily: 'Courier',
    fontWeight: '600',
    color: '#111827',
  },
  /**
   * Padding here is the QR quiet zone, not decoration.
   *
   * The spec asks for four clear modules on every side; without it many
   * scanners cannot lock onto the finder patterns at all. The value is applied
   * inline from the derived cell size so it scales with the code.
   */
  qrContainer: {
    backgroundColor: '#FFFFFF',
  },
  qrRow: {
    flexDirection: 'row',
  },
  qrCell: {
    width: 6,
    height: 6,
  },

  // Modal styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    padding: Spacing.six,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    position: 'relative',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  },
  closeButton: {
    position: 'absolute',
    top: Spacing.three,
    right: Spacing.three,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginTop: Spacing.two,
    marginBottom: Spacing.one,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: Spacing.five,
    paddingHorizontal: Spacing.two,
  },
  modalCodeBox: {
    backgroundColor: '#FFFFFF',
    padding: Spacing.four,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  modalBarcodeContainer: {
    alignItems: 'center',
    width: '100%',
  },
  modalBarcodeBars: {
    flexDirection: 'row',
    height: 120,
    alignItems: 'stretch',
    justifyContent: 'center',
    width: '100%',
  },
  modalBarcodeBar: {
    flex: 1,
  },
  modalBarcodeNumber: {
    marginTop: Spacing.three,
    fontSize: 16,
    letterSpacing: 3,
    fontFamily: 'Courier',
    fontWeight: '700',
    color: '#111827',
  },
  modalQrContainer: {
    backgroundColor: '#FFFFFF',
  },
  modalQrRow: {
    flexDirection: 'row',
  },
  modalQrCell: {
    width: 10,
    height: 10,
  },
});
