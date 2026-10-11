export interface SpecificationFrontMatter {
  title: string;
  version: string;
  status: string;
  date: string;
  lastmod: string;
  javaversion: string;
  revision: string;
  [key: string]: string | number | boolean | null;
}
export interface SpecificationMetadata extends SpecificationFrontMatter {
  specificationVersion: string;
}
export interface SpecificationRecord {
  file: string;
  specificationVersion: string;
  metadata: Readonly<SpecificationMetadata>;
  markdown: string;
}
export declare const latestVersion: string;
export declare const versions: Readonly<Record<string, SpecificationRecord>>;
export declare const drafts: Readonly<Record<string, SpecificationRecord>>;
