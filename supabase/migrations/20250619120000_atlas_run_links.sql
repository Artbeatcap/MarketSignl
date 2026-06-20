-- Link unified Atlas runs: forecast (predictions) + levels (chart_analyses)

ALTER TABLE public.chart_analyses
  ADD COLUMN IF NOT EXISTS prediction_id UUID REFERENCES public.predictions(id) ON DELETE SET NULL;

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS analysis_id UUID REFERENCES public.chart_analyses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chart_analyses_prediction_id
  ON public.chart_analyses(prediction_id);

CREATE INDEX IF NOT EXISTS idx_predictions_analysis_id
  ON public.predictions(analysis_id);
