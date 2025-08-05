import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    this.supabase = createClient(
      this.configService.get<string>('SUPABASE_URL')!,
      this.configService.get<string>('SUPABASE_KEY')!,
    );
  }

  /**
   * Get the chat history URL for a given session ID.
   * @param sessionId - The session identifier.
   * @returns The Cloudinary URL of the chat history or null.
   */
  async getHistoryUrl(sessionId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('chat_history')
      .select('history_url')
      .eq('sessionId', sessionId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('Error fetching history URL from Supabase:', error);
      throw error;
    }

    return data ? data.history_url : null;
  }

  /**
   * Upsert the chat history URL for a given session.
   * This will create a new record if one doesn't exist, or update the existing one.
   * @param sessionId - The session identifier.
   * @param historyUrl - The Cloudinary URL of the chat history.
   */
  async upsertHistoryUrl(sessionId: string, historyUrl: string): Promise<void> {
    const { error } = await this.supabase
      .from('chat_history')
      .upsert({
        sessionId,
        history_url: historyUrl,
        userId: 'demo', // Using 'demo' as a placeholder for now
      }, { onConflict: 'sessionId' });

    if (error) {
      console.error('Error upserting history URL to Supabase:', error);
      throw error;
    }
  }
}
