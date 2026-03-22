import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { File, Prisma } from '@prisma/client';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { PrismaService } from '../prisma/prisma.service';
import {
  FileAnalysisDivergenceDto,
  FileAnalysisItemDto,
  FileAnalysisResponseDto,
  FileAnalysisTotalsDto,
} from './dto/file-analysis-response.dto';
import { FileResponseDto, ListFilesResponseDto } from './dto/file-response.dto';
import { ListFilesQueryDto } from './dto/list-files-query.dto';
import { filePublicSelect, toFileResponse } from './files.mapper';

type CreateFileInput = {
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedById: string;
};

const fileNotFoundMessage = 'File not found.';
const fileNotFoundInStorageMessage = 'File not found in storage.';
const invalidXmlMessage = 'Unable to parse XML file for analysis.';

type ParsedXmlNode = Record<string, unknown>;

@Injectable()
export class FilesService {
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });

  constructor(private readonly prisma: PrismaService) {}

  private asRecord(value: unknown): ParsedXmlNode | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as ParsedXmlNode;
  }

  private asString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      const normalized = `${value}`.trim();
      return normalized.length > 0 ? normalized : null;
    }

    return null;
  }

  private asNumber(value: unknown): number | null {
    const normalized = this.asString(value);

    if (!normalized) {
      return null;
    }

    const parsed = Number.parseFloat(normalized.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private asInteger(value: unknown): number | null {
    const parsed = this.asNumber(value);

    if (parsed === null) {
      return null;
    }

    return Math.trunc(parsed);
  }

  private toArray<T>(value: T | T[] | null | undefined): T[] {
    if (value === null || value === undefined) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  private getFirstNestedObject(value: unknown): ParsedXmlNode | null {
    const node = this.asRecord(value);

    if (!node) {
      return null;
    }

    for (const nestedValue of Object.values(node)) {
      const nestedObject = this.asRecord(nestedValue);
      if (nestedObject) {
        return nestedObject;
      }
    }

    return null;
  }

  private normalizeNfeKeyById(value: string | null): string | null {
    if (!value) {
      return null;
    }

    return value.startsWith('NFe') ? value.slice(3) : value;
  }

  private getItemNumbers(
    items: FileAnalysisItemDto[],
    predicate: (item: FileAnalysisItemDto) => boolean,
  ) {
    return items
      .filter(predicate)
      .map((item) => item.item)
      .filter((item): item is number => typeof item === 'number');
  }

  private createDivergence(
    code: string,
    title: string,
    description: string,
    itemNumbers?: number[],
  ): FileAnalysisDivergenceDto {
    return {
      code,
      title,
      description,
      severity: 'WARNING',
      itemNumbers:
        itemNumbers && itemNumbers.length > 0 ? itemNumbers : undefined,
    };
  }

  private getNfeNodes(parsedXml: ParsedXmlNode) {
    const nfeProc = this.asRecord(parsedXml['nfeProc']);
    const nfeNode = this.asRecord(nfeProc?.['NFe'] ?? parsedXml['NFe']);
    const infNfe = this.asRecord(nfeNode?.['infNFe']);

    if (!infNfe) {
      throw new UnprocessableEntityException(
        'XML file does not contain infNFe node.',
      );
    }

    const protNfe = this.asRecord(nfeProc?.['protNFe'] ?? parsedXml['protNFe']);
    const infProt = this.asRecord(protNfe?.['infProt']);

    return { infNfe, infProt };
  }

  private getTotalsFromXml(infNfe: ParsedXmlNode): FileAnalysisTotalsDto {
    const totalNode = this.asRecord(infNfe['total']);
    const icmsTot = this.asRecord(totalNode?.['ICMSTot']);

    return {
      vProd: this.asNumber(icmsTot?.['vProd']),
      vDesc: this.asNumber(icmsTot?.['vDesc']),
      vFrete: this.asNumber(icmsTot?.['vFrete']),
      vNF: this.asNumber(icmsTot?.['vNF']),
      vPIS: this.asNumber(icmsTot?.['vPIS']),
      vCOFINS: this.asNumber(icmsTot?.['vCOFINS']),
      vICMS: this.asNumber(icmsTot?.['vICMS']),
    };
  }

  private getItemsFromXml(infNfe: ParsedXmlNode): FileAnalysisItemDto[] {
    const detEntries = this.toArray(infNfe['det']);
    const items: FileAnalysisItemDto[] = [];

    detEntries.forEach((detEntry, index) => {
      const detNode = this.asRecord(detEntry);

      if (!detNode) {
        return;
      }

      const productNode = this.asRecord(detNode['prod']);
      const taxNode = this.asRecord(detNode['imposto']);
      const icmsNode = this.getFirstNestedObject(
        this.asRecord(taxNode?.['ICMS']),
      );
      const pisNode = this.getFirstNestedObject(
        this.asRecord(taxNode?.['PIS']),
      );
      const cofinsNode = this.getFirstNestedObject(
        this.asRecord(taxNode?.['COFINS']),
      );

      items.push({
        item: this.asInteger(detNode['nItem']) ?? index + 1,
        code: this.asString(productNode?.['cProd']),
        description: this.asString(productNode?.['xProd']),
        ncm: this.asString(productNode?.['NCM']),
        cest: this.asString(productNode?.['CEST']),
        cfop: this.asString(productNode?.['CFOP']),
        quantity: this.asNumber(productNode?.['qCom']),
        unitValue: this.asNumber(productNode?.['vUnCom']),
        totalValue: this.asNumber(productNode?.['vProd']),
        taxes: {
          icmsCstOrCsosn:
            this.asString(icmsNode?.['CSOSN']) ??
            this.asString(icmsNode?.['CST']),
          pisCst: this.asString(pisNode?.['CST']),
          pisValue: this.asNumber(pisNode?.['vPIS']),
          cofinsCst: this.asString(cofinsNode?.['CST']),
          cofinsValue: this.asNumber(cofinsNode?.['vCOFINS']),
        },
      });
    });

    return items;
  }

  private getUniqueValues(values: Array<string | null>) {
    return [
      ...new Set(values.filter((value): value is string => Boolean(value))),
    ];
  }

  private buildAnalysisFromXml(
    file: File,
    xmlContent: string,
  ): FileAnalysisResponseDto {
    let parsedXml: ParsedXmlNode;

    try {
      parsedXml = this.asRecord(this.xmlParser.parse(xmlContent)) ?? {};
    } catch {
      throw new UnprocessableEntityException(invalidXmlMessage);
    }

    const { infNfe, infProt } = this.getNfeNodes(parsedXml);

    const ideNode = this.asRecord(infNfe['ide']);
    const emitNode = this.asRecord(infNfe['emit']);
    const emitAddressNode = this.asRecord(emitNode?.['enderEmit']);

    const items = this.getItemsFromXml(infNfe);
    const totals = this.getTotalsFromXml(infNfe);
    const uniqueCfops = this.getUniqueValues(items.map((item) => item.cfop));
    const uniqueIcmsCodes = this.getUniqueValues(
      items.map((item) => item.taxes.icmsCstOrCsosn),
    );

    const divergences: FileAnalysisDivergenceDto[] = [];

    if (uniqueCfops.length > 1) {
      divergences.push(
        this.createDivergence(
          'CFOP_MIX',
          'Mistura de CFOPs',
          `Foram encontrados ${uniqueCfops.length} CFOPs diferentes no mesmo XML: ${uniqueCfops.join(', ')}.`,
        ),
      );
    }

    const itemsWithoutCest = this.getItemNumbers(items, (item) => !item.cest);

    if (itemsWithoutCest.length > 0) {
      divergences.push(
        this.createDivergence(
          'MISSING_CEST',
          'Ausencia de CEST',
          `${itemsWithoutCest.length} item(ns) sem CEST informado.`,
          itemsWithoutCest,
        ),
      );
    }

    if (uniqueIcmsCodes.length > 1) {
      divergences.push(
        this.createDivergence(
          'ICMS_CST_CSOSN_MIX',
          'CST/CSOSN diferente entre itens',
          `Foram identificados codigos ICMS diferentes entre os itens: ${uniqueIcmsCodes.join(', ')}.`,
        ),
      );
    }

    const itemsWithZeroPisOrCofins = this.getItemNumbers(
      items,
      (item) => item.taxes.pisValue === 0 || item.taxes.cofinsValue === 0,
    );

    if (itemsWithZeroPisOrCofins.length > 0) {
      divergences.push(
        this.createDivergence(
          'PIS_COFINS_ZERO',
          'PIS/COFINS zerado',
          `${itemsWithZeroPisOrCofins.length} item(ns) com PIS ou COFINS zerado.`,
          itemsWithZeroPisOrCofins,
        ),
      );
    }

    const itemsTotalValue = items.reduce(
      (accumulator, item) => accumulator + (item.totalValue ?? 0),
      0,
    );

    if (
      totals.vProd !== null &&
      Math.abs(itemsTotalValue - totals.vProd) > 0.01
    ) {
      divergences.push(
        this.createDivergence(
          'TOTAL_MISMATCH',
          'Total dos itens divergente do XML',
          `Somatorio dos itens (${itemsTotalValue.toFixed(2)}) difere de total.vProd (${totals.vProd.toFixed(2)}).`,
        ),
      );
    }

    const fiscalNotes: string[] = [];
    const model = this.asString(ideNode?.['mod']);
    const crt = this.asString(emitNode?.['CRT']);
    const protocol = this.asString(infProt?.['nProt']);

    if (model === '65') {
      fiscalNotes.push('Documento identificado como NFC-e (modelo 65).');
    }

    if (crt === '1') {
      fiscalNotes.push('Emitente enquadrado no Simples Nacional (CRT=1).');
    }

    if (protocol) {
      fiscalNotes.push(
        `Documento possui protocolo de autorizacao ${protocol}.`,
      );
    }

    if (uniqueCfops.length === 1 && uniqueCfops[0]) {
      fiscalNotes.push(
        `Todos os itens utilizam o mesmo CFOP (${uniqueCfops[0]}).`,
      );
    }

    return {
      file: {
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        status: file.status,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      },
      company: {
        corporateName: this.asString(emitNode?.['xNome']),
        tradeName: this.asString(emitNode?.['xFant']),
        cnpj: this.asString(emitNode?.['CNPJ']),
        ie: this.asString(emitNode?.['IE']),
        uf: this.asString(emitAddressNode?.['UF']),
        crt,
      },
      document: {
        number: this.asString(ideNode?.['nNF']),
        series: this.asString(ideNode?.['serie']),
        model,
        issuedAt:
          this.asString(ideNode?.['dhEmi']) ?? this.asString(ideNode?.['dEmi']),
        key:
          this.asString(infProt?.['chNFe']) ??
          this.normalizeNfeKeyById(this.asString(infNfe['Id'])),
        protocol,
        operationNature: this.asString(ideNode?.['natOp']),
        items,
        totals,
      },
      analysisSummary: {
        status: divergences.length > 0 ? 'ATTENTION' : 'OK',
        totalItems: items.length,
        totalDivergences: divergences.length,
        totalWarnings: divergences.filter(
          (divergence) => divergence.severity === 'WARNING',
        ).length,
        uniqueCfops,
      },
      divergences,
      fiscalNotes,
    };
  }

  async getFileAnalysisById(id: string): Promise<FileAnalysisResponseDto> {
    const file = await this.findById(id);
    const absolutePath = resolve(process.cwd(), file.path);

    if (!existsSync(absolutePath)) {
      throw new NotFoundException(fileNotFoundInStorageMessage);
    }

    const xmlContent = await readFile(absolutePath, 'utf-8');
    return this.buildAnalysisFromXml(file, xmlContent);
  }

  private getDateFrom(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T00:00:00.000Z`);
    }

    return new Date(value);
  }

  private getDateTo(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }

    return new Date(value);
  }

  async create(input: CreateFileInput): Promise<FileResponseDto> {
    const file = await this.prisma.file.create({
      data: input,
      select: filePublicSelect,
    });

    return toFileResponse(file);
  }

  async list(query: ListFilesQueryDto): Promise<ListFilesResponseDto> {
    const { page, pageSize, search, dateFrom, dateTo } = query;

    const where: Prisma.FileWhereInput = {};

    if (search) {
      where.originalName = {
        contains: search,
        mode: 'insensitive',
      };
    }

    const createdAt: Prisma.DateTimeFilter = {};

    if (dateFrom) {
      createdAt.gte = this.getDateFrom(dateFrom);
    }

    if (dateTo) {
      createdAt.lte = this.getDateTo(dateTo);
    }

    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.file.count({ where }),
      this.prisma.file.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: filePublicSelect,
      }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      data: data.map(toFileResponse),
    };
  }

  async findPublicById(id: string): Promise<FileResponseDto> {
    const file = await this.prisma.file.findUnique({
      where: { id },
      select: filePublicSelect,
    });

    if (!file) {
      throw new NotFoundException(fileNotFoundMessage);
    }

    return toFileResponse(file);
  }

  async findById(id: string) {
    const file = await this.prisma.file.findUnique({
      where: { id },
    });

    if (!file) {
      throw new NotFoundException(fileNotFoundMessage);
    }

    return file;
  }
}
