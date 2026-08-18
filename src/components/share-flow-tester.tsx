import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Alert } from 'react-native';

import { DestinationChooser } from '@/components/destination-chooser';
import { Row } from '@/components/ui/list';

/**
 * Exercises the share flow without the OS share sheet.
 *
 * The real entry point is the iOS/Android share sheet, which needs the signed
 * native share extension (blocked on a paid Apple account). Everything after
 * the file arrives — the destination chooser, the routing, the auto-attach and
 * scan — is plain app code, and this lets it be tested today by picking a file
 * in-app and running it through the exact same chooser.
 *
 * Remove this row, or repurpose it as a real "Add from Files" action, once the
 * share extension ships.
 */
export function ShareFlowTester() {
  const [filePath, setFilePath] = useState<string | null>(null);

  async function pick() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      setFilePath(result.assets[0].uri);
    } catch (error) {
      Alert.alert('Could not open that file', String(error));
    }
  }

  return (
    <>
      <Row
        title="Test share flow"
        subtitle="Pick a photo or PDF, then choose where it goes"
        icon="share"
        iconColor="accent"
        chevron={false}
        onPress={pick}
      />
      <DestinationChooser filePath={filePath} onClose={() => setFilePath(null)} />
    </>
  );
}
