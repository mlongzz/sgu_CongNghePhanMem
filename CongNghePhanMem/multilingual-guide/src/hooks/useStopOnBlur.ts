import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

export function useStopOnBlur(onBlur: () => void) {
  useFocusEffect(useCallback(() => () => onBlur(), [onBlur]));
}
