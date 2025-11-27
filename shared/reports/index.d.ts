export type ReportFormat = 'excel' | 'pdf';
export type ReportColumnDataType = 'text' | 'number' | 'date' | 'datetime' | 'currency';

export interface ReportColumnDefinition {
  key: string;
  label: string;
  dataType?: ReportColumnDataType;
}

export interface ReportFilterHints {
  requiresDateRange?: boolean;
  defaultRangeDays?: number;
  allowDriverId?: boolean;
  allowTruckId?: boolean;
  allowFrequencyMinutes?: boolean;
}

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  columns: ReportColumnDefinition[];
  filters?: ReportFilterHints;
}

export declare const REPORT_FORMATS: ReadonlyArray<ReportFormat>;
export declare const REPORT_DEFINITIONS: ReadonlyArray<ReportDefinition>;
export declare const REPORT_DEFINITION_MAP: Readonly<Record<string, ReportDefinition>>;
export declare function getReportDefinition(key: string): ReportDefinition | null;
