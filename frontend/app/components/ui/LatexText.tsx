import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface LatexTextProps {
  children: string;
  className?: string;
}

/**
 * 将 LaTeX 分隔符从 \( ... \) 转换为 $...$ 格式
 */
function convertLatexDelimiters(text: string): string {
  if (!text) return text;

  // 转换 \( ... \) 为 $ ... $ (行内公式)
  let result = text.replace(/\\\((.+?)\\\)/g, '$$$1$$');

  // 转换 \[ ... \] 为 $$ ... $$ (块级公式)
  result = result.replace(/\\\[(.+?)\\\]/gs, '$$$$$1$$$$');

  return result;
}

/**
 * 渲染包含 LaTeX 公式的文本
 */
export function LatexText({ children, className = '' }: LatexTextProps) {
  const processedText = useMemo(() => convertLatexDelimiters(children || ''), [children]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Markdown = ReactMarkdown as any;

  return (
    <div className={className}>
      <Markdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {processedText}
      </Markdown>
    </div>
  );
}

export default LatexText;
