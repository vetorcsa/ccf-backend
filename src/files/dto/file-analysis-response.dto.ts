import { FileStatus } from '@prisma/client';

export type FileAnalysisFileInfoDto = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: FileStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type FileAnalysisCompanyDto = {
  corporateName: string | null;
  tradeName: string | null;
  cnpj: string | null;
  ie: string | null;
  uf: string | null;
  crt: string | null;
};

export type FileAnalysisItemTaxesDto = {
  icmsCstOrCsosn: string | null;
  pisCst: string | null;
  pisValue: number | null;
  cofinsCst: string | null;
  cofinsValue: number | null;
};

export type FileAnalysisItemDto = {
  item: number | null;
  code: string | null;
  description: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  quantity: number | null;
  unitValue: number | null;
  totalValue: number | null;
  taxes: FileAnalysisItemTaxesDto;
};

export type FileAnalysisTotalsDto = {
  vProd: number | null;
  vDesc: number | null;
  vFrete: number | null;
  vNF: number | null;
  vPIS: number | null;
  vCOFINS: number | null;
  vICMS: number | null;
};

export type FileAnalysisDocumentDto = {
  number: string | null;
  series: string | null;
  model: string | null;
  issuedAt: string | null;
  key: string | null;
  protocol: string | null;
  operationNature: string | null;
  items: FileAnalysisItemDto[];
  totals: FileAnalysisTotalsDto;
};

export type FileAnalysisDivergenceDto = {
  code: string;
  title: string;
  description: string;
  severity: 'INFO' | 'WARNING';
  itemNumbers?: number[];
};

export type FileAnalysisSummaryDto = {
  status: 'OK' | 'ATTENTION';
  totalItems: number;
  totalDivergences: number;
  totalWarnings: number;
  uniqueCfops: string[];
};

export type FileAnalysisResponseDto = {
  file: FileAnalysisFileInfoDto;
  company: FileAnalysisCompanyDto;
  document: FileAnalysisDocumentDto;
  analysisSummary: FileAnalysisSummaryDto;
  divergences: FileAnalysisDivergenceDto[];
  fiscalNotes: string[];
};
