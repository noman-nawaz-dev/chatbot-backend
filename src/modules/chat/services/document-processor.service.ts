import { Injectable } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { CSVLoader } from '@langchain/community/document_loaders/fs/csv';
import { TextLoader } from 'langchain/document_loaders/fs/text';
import { ProcessedContent } from '../interfaces/processor.interface';
import { LangSmithService } from './langsmith.service';
import { extractRawText } from 'mammoth';
import { read, utils } from 'xlsx';
import { promises as fsPromises } from 'fs';
import { unlink } from 'fs/promises';

interface DocumentLoader {
  load(): Promise<Array<{ pageContent: string; metadata?: any }>>;
}

interface PDFLoaderConstructor {
  new (filePath: string, options?: any): DocumentLoader;
}

interface CSVLoaderConstructor {
  new (filePath: string, options?: any): DocumentLoader;
}

const TypedPDFLoader = PDFLoader as unknown as PDFLoaderConstructor;
const TypedCSVLoader = CSVLoader as unknown as CSVLoaderConstructor;

@Injectable()
export class DocumentProcessorService {
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor(private langSmith: LangSmithService) {
    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
  }

  async processDocument(file: Express.Multer.File): Promise<ProcessedContent[]> {
    try {
      let content: string;
      const fileExtension = file.originalname.split('.').pop()?.toLowerCase();

      switch (fileExtension) {
        case 'pdf':
          content = await this.processPDF(file);
          break;
        case 'docx':
          content = await this.processDOCX(file);
          break;
        case 'txt':
          content = await this.processTXT(file);
          break;
        case 'csv':
          content = await this.processCSV(file);
          break;
        case 'xlsx':
        case 'xls':
          content = await this.processExcel(file);
          break;
        default:
          throw new Error(`Unsupported file format: ${fileExtension}`);
      }

      const chunks = await this.textSplitter.splitText(content);
      
      const processedChunks: ProcessedContent[] = chunks.map((chunk, index) => ({
        type: 'document',
        content: chunk,
        metadata: {
          filename: file.originalname,
          fileType: fileExtension,
          chunkIndex: index,
          totalChunks: chunks.length,
          size: file.size,
        },
      }));

      await this.langSmith.traceRun('document_processing', {
        filename: file.originalname,
        fileType: fileExtension,
        originalSize: file.size,
      }, {
        chunksCreated: processedChunks.length,
        totalContentLength: content.length,
      });

      // Delete the file after successful processing
      await this.cleanupFile(file.path);

      return processedChunks;
    } catch (error) {
      // Clean up file even if processing fails
      await this.cleanupFile(file.path);
      
      await this.langSmith.traceRun('document_processing_error', {
        filename: file.originalname,
      }, {}, error as Error);
      throw error;
    }
  }

  private async processPDF(file: Express.Multer.File): Promise<string> {
    const loader = new TypedPDFLoader(file.path);
    const docs = await loader.load();
    return docs.map(doc => doc.pageContent).join('\n');
  }

  private async processDOCX(file: Express.Multer.File): Promise<string> {
    const buffer = await fsPromises.readFile(file.path);
    const result = await extractRawText({ buffer });
    return result.value;
  }

  private async processTXT(file: Express.Multer.File): Promise<string> {
    const loader = new TextLoader(file.path);
    const docs = await loader.load();
    return docs.map(doc => doc.pageContent).join('\n');
  }

  private async processCSV(file: Express.Multer.File): Promise<string> {
    const loader = new TypedCSVLoader(file.path);
    const docs = await loader.load();
    return docs.map(doc => doc.pageContent).join('\n');
  }

  private async processExcel(file: Express.Multer.File): Promise<string> {
    try {
      const buffer = await fsPromises.readFile(file.path);
      const workbook = read(buffer, { type: 'buffer' });
      
      let content = '';
      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = utils.sheet_to_json(worksheet, { header: 1 });
        content += `Sheet: ${sheetName}\n`;
        content += jsonData.map(row => (row as any[]).join('\t')).join('\n');
        content += '\n\n';
      });
      
      return content;
    } catch (error) {
      throw new Error(`Failed to process Excel: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async cleanupFile(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
      console.log(`Deleted processed file: ${filePath}`);
    } catch (error) {
      console.error(`Failed to delete file ${filePath}:`, error);
      // Don't throw error for cleanup failures to avoid masking processing errors
    }
  }
}
