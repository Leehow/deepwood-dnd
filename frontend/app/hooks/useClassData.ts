import { useState, useEffect } from 'react';
import {
  loadClassData,
  getClassData,
  getClassLevelFeatures,
  getClassLevelData,
  isSpellcaster,
  type ClassData,
  type ClassFeature
} from '~/utils/classDataLoader';

/**
 * Hook to load all class data
 */
export function useAllClassData() {
  const [classesData, setClassesData] = useState<Record<string, ClassData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    loadClassData()
      .then(data => {
        setClassesData(data.classes);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, []);

  return { classesData, loading, error };
}

/**
 * Hook to load a specific class data
 */
export function useClassData(classId: string | null) {
  const [classData, setClassData] = useState<ClassData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!classId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    getClassData(classId)
      .then(data => {
        setClassData(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, [classId]);

  return { classData, loading, error };
}

/**
 * Hook to get features for a specific class level
 */
export function useClassLevelFeatures(classId: string | null, level: number) {
  const [features, setFeatures] = useState<ClassFeature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!classId || level < 1) {
      setLoading(false);
      return;
    }

    setLoading(true);
    getClassLevelFeatures(classId, level)
      .then(data => {
        setFeatures(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, [classId, level]);

  return { features, loading, error };
}

/**
 * Hook to get all level data for a specific class level
 */
export function useClassLevelData(classId: string | null, level: number) {
  const [levelData, setLevelData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!classId || level < 1) {
      setLoading(false);
      return;
    }

    setLoading(true);
    getClassLevelData(classId, level)
      .then(data => {
        setLevelData(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, [classId, level]);

  return { levelData, loading, error };
}

/**
 * Hook to check if a class is a spellcaster
 */
export function useIsSpellcaster(classId: string | null) {
  const [isSpellcasterClass, setIsSpellcasterClass] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!classId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    isSpellcaster(classId)
      .then(result => {
        setIsSpellcasterClass(result);
        setLoading(false);
      })
      .catch(() => {
        setIsSpellcasterClass(false);
        setLoading(false);
      });
  }, [classId]);

  return { isSpellcasterClass, loading };
}
