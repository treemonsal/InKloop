import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
export default function RichText({text}:{text:string}){return <div className="rich-text"><Markdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[rehypeKatex]} components={{a:({children,...props})=><a {...props} target="_blank" rel="noopener noreferrer">{children}</a>}}>{text}</Markdown></div>;}
