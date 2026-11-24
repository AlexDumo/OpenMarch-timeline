import { useQuery } from "@tanstack/react-query";
import { fieldPropertiesQueryOptions } from "@/hooks/queries/useFieldProperties";
import { useDatabaseReady } from "@/hooks/useDatabaseReady";
import type { MeasurementSystem } from "@/utilities/showLengths";

/**
 * The show's units, from its field: imperial or metric. Imperial until the field loads, which is
 * also the field's default.
 */
export function useMeasurementSystem(): MeasurementSystem {
    const databaseReady = useDatabaseReady();
    const { data } = useQuery(fieldPropertiesQueryOptions(databaseReady));
    return data?.measurementSystem ?? "imperial";
}
