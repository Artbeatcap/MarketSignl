import OpenAI from 'openai';
import type { ChartAnalysis } from '@chartsignl/core';
import { CHART_ANALYSIS_SYSTEM_PROMPT, CHART_ANALYSIS_USER_PROMPT } from '../prompts/chartAnalysis.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface VisionAnalysisResult {
  success: boolean;
  analysis?: ChartAnalysis;
  error?: string;
  rawResponse?: string;
}

/**
 * Analyze a chart image using OpenAI Vision
 * @param imageUrl - Public URL of the chart image
 * @returns Structured ChartAnalysis object
 */
export async function analyzeChartWithVision(imageUrl: string): Promise<VisionAnalysisResult> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: CHART_ANALYSIS_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: CHART_ANALYSIS_USER_PROMPT,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high', // Use high detail for better chart analysis
              },
            },
          ],
        },
      ],
      max_completion_tokens: 4096,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      return {
        success: false,
        error: 'No response from OpenAI',
      };
    }

    // Clean the response - remove any markdown code blocks if present
    let cleanedContent = content.trim();
    if (cleanedContent.startsWith('```json')) {
      cleanedContent = cleanedContent.slice(7);
    } else if (cleanedContent.startsWith('```')) {
      cleanedContent = cleanedContent.slice(3);
    }
    if (cleanedContent.endsWith('```')) {
      cleanedContent = cleanedContent.slice(0, -3);
    }
    cleanedContent = cleanedContent.trim();

    // Parse and validate the JSON
    const analysis = JSON.parse(cleanedContent) as ChartAnalysis;
    
    // Basic validation
    if (!analysis.meta || !analysis.levels || !analysis.summary) {
      return {
        success: false,
        error: 'Invalid analysis structure',
        rawResponse: content,
      };
    }

    return {
      success: true,
      analysis,
    };
  } catch (error) {
    console.error('OpenAI Vision error:', error);
    
    if (error instanceof SyntaxError) {
      return {
        success: false,
        error: 'Failed to parse AI response as JSON',
      };
    }
    
    if (error instanceof OpenAI.APIError) {
      return {
        success: false,
        error: `OpenAI API error: ${error.message}`,
      };
    }
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Analyze chart from base64 encoded image
 * @param base64Data - Base64 encoded image data
 * @param mimeType - Image MIME type (image/png, image/jpeg, etc.)
 */
export async function analyzeChartFromBase64(
  base64Data: string,
  mimeType: string
): Promise<VisionAnalysisResult> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: CHART_ANALYSIS_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: CHART_ANALYSIS_USER_PROMPT,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_completion_tokens: 4096,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      return {
        success: false,
        error: 'No response from OpenAI',
      };
    }

    // Clean and parse
    let cleanedContent = content.trim();
    if (cleanedContent.startsWith('```json')) {
      cleanedContent = cleanedContent.slice(7);
    } else if (cleanedContent.startsWith('```')) {
      cleanedContent = cleanedContent.slice(3);
    }
    if (cleanedContent.endsWith('```')) {
      cleanedContent = cleanedContent.slice(0, -3);
    }
    cleanedContent = cleanedContent.trim();

    const analysis = JSON.parse(cleanedContent) as ChartAnalysis;
    
    if (!analysis.meta || !analysis.levels || !analysis.summary) {
      return {
        success: false,
        error: 'Invalid analysis structure',
        rawResponse: content,
      };
    }

    return {
      success: true,
      analysis,
    };
  } catch (error) {
    console.error('OpenAI Vision error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
