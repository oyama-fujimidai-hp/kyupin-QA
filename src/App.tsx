/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Search, Loader2, ExternalLink, AlertCircle, BookOpen, Sparkles, HelpCircle, ChevronRight, MessageCircle, Copy, Check, Download, LogIn, LogOut, User as UserIcon, History, Trash2, Clock, X } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider } from './lib/firebase';
import { doc, getDocFromServer, collection, addDoc, query as fsQuery, orderBy, limit, getDocs, deleteDoc, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { db } from './lib/firebase';

// Google GenAI SDK Initialization
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

// ✨ マークダウン形式のテキストを読みやすく表示するためのコンポーネント
interface FormattedTextProps {
  text: string;
}

const FormattedText: React.FC<FormattedTextProps> = ({ text }) => {
  if (!text) return null;
  
  const renderInline = (lineText: string) => {
    // 太字の処理 (**テキスト**)
    const parts = lineText.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-white">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  const renderLine = (line: string, index: number) => {
    // 見出しの処理 (###, ##, #)
    if (line.startsWith('### ')) return <h3 key={index} className="text-lg font-bold mt-4 mb-2 text-slate-100">{line.replace('### ', '')}</h3>;
    if (line.startsWith('## ')) return <h2 key={index} className="text-xl font-bold mt-5 mb-3 border-b border-slate-700 pb-1 text-slate-100">{line.replace('## ', '')}</h2>;
    if (line.startsWith('# ')) return <h1 key={index} className="text-2xl font-bold mt-6 mb-4 border-b border-slate-700 pb-2 text-white">{line.replace('# ', '')}</h1>;
    // リストの処理 (-, *)
    if (line.startsWith('- ') || line.startsWith('* ')) return <li key={index} className="ml-5 list-disc mb-1 text-slate-300">{renderInline(line.substring(2))}</li>;
    
    // 通常の段落
    return <p key={index} className="mb-2 text-slate-300">{renderInline(line)}</p>;
  };

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];

  lines.forEach((line, index) => {
    if (line.startsWith('- ') || line.startsWith('* ')) {
      listItems.push(renderLine(line, index));
      inList = true;
    } else {
      if (inList) {
        elements.push(<ul key={`ul-${index}`} className="my-2 space-y-1">{listItems}</ul>);
        listItems = [];
        inList = false;
      }
      if (line.trim() === '') {
        // 空行で適度な余白を作る
        elements.push(<div key={`empty-${index}`} className="h-3"></div>);
      } else {
        elements.push(renderLine(line, index));
      }
    }
  });

  // 最後にリストが残っていた場合の処理
  if (inList) {
    elements.push(<ul key={`ul-end`} className="my-2 space-y-1">{listItems}</ul>);
  }

  return <div className="text-slate-300 leading-relaxed text-base sm:text-lg">{elements}</div>;
};

interface Source {
  uri?: string;
  title?: string;
}

// 検索履歴のインターフェース
interface SearchHistory {
  id: string;
  query: string;
  answer: string;
  sources?: string;
  createdAt: Date;
}

// ブログ記事のURLかどうか判定するヘルパー関数
const isBlogSource = (uri?: string): boolean => {
  if (!uri) return false;
  return uri.includes('ameblo.jp/kyupin') || uri.includes('kyupin');
};

// おすすめキーワード（カテゴリ分け）
const KEYWORD_CATEGORIES = [
  {
    label: "疾患",
    keywords: ["統合失調症", "うつ病", "双極性障害", "発達障害", "パニック障害", "強迫性障害", "PTSD"]
  },
  {
    label: "薬剤",
    keywords: ["パキシル", "リスパダール", "デパケン", "睡眠薬", "漢方薬", "ベンゾジアゼピン"]
  },
  {
    label: "テーマ",
    keywords: ["減薬", "副作用", "治療経過", "入院", "外来", "診断"]
  }
];

// 自由な質問の例文
const EXAMPLE_QUESTIONS = [
  "パキシルの離脱症状について教えてください",
  "統合失調症の薬物療法の考え方",
  "不眠に対するkyupin先生のアプローチ",
  "発達障害と二次障害について"
];

// ログイン許可するメールアドレスのホワイトリスト
const ALLOWED_EMAILS = [
  "yas2x27@gmail.com",
  "yas2@oyama-fujimidai-hp.com"
];

export default function App() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // ✨ Auth State
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // ✨ LLM機能用の追加状態
  const [simplifiedAnswer, setSimplifiedAnswer] = useState('');
  const [followUpQuestions, setFollowUpQuestions] = useState<string[]>([]);
  const [isSimplifying, setIsSimplifying] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  
  // ✨ コピー・保存機能用の状態
  const [copied, setCopied] = useState(false);

  // ✨ 履歴機能用の状態
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 履歴をFirestoreから取得する関数
  const fetchHistory = async (uid: string) => {
    setHistoryLoading(true);
    try {
      const historyRef = collection(db, 'users', uid, 'searches');
      // インデックス作成エラーを避けるためorderByを外し、whereのみで取得してからローカルソート
      const q = fsQuery(historyRef, where('userId', '==', uid), limit(30));
      const snapshot = await getDocs(q);
      const items: SearchHistory[] = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          query: data.query,
          answer: data.answer,
          sources: data.sources || '',
          createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
        };
      });
      // ローカルで降順ソート
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      setSearchHistory(items);
    } catch (err: any) {
      console.error('履歴取得エラー:', err);
      setError('履歴の取得に失敗しました: ' + (err.message || '不明なエラー'));
    } finally {
      setHistoryLoading(false);
    }
  };

  // 検索結果をFirestoreに保存する関数
  const saveToHistory = async (searchQuery: string, searchAnswer: string, searchSources: Source[]) => {
    if (!user) return;
    try {
      const historyRef = collection(db, 'users', user.uid, 'searches');
      const sourcesStr = JSON.stringify(searchSources.slice(0, 5));
      await addDoc(historyRef, {
        userId: user.uid,
        query: searchQuery.substring(0, 500),
        answer: searchAnswer.substring(0, 10000),
        sources: sourcesStr.substring(0, 2000),
        createdAt: serverTimestamp(),
      });
      // 保存後に履歴を再取得
      fetchHistory(user.uid);
    } catch (err: any) {
      console.error('履歴保存エラー:', err);
      setError('履歴の保存に失敗しました: ' + (err.message || '不明なエラー'));
    }
  };

  // 履歴を削除する関数
  const deleteHistory = async (historyId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'searches', historyId));
      setSearchHistory(prev => prev.filter(h => h.id !== historyId));
    } catch (err) {
      console.error('履歴削除エラー:', err);
    }
  };

  // 履歴から復元する関数
  const restoreFromHistory = (item: SearchHistory) => {
    setQuery(item.query);
    setAnswer(item.answer);
    try {
      const parsed = item.sources ? JSON.parse(item.sources) : [];
      setSources(parsed);
    } catch { setSources([]); }
    setSimplifiedAnswer('');
    setFollowUpQuestions([]);
    setShowHistory(false);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // ホワイトリストチェック
      if (currentUser && currentUser.email) {
        const isAllowed = ALLOWED_EMAILS.includes(currentUser.email);
        if (!isAllowed) {
          signOut(auth);
          setUser(null);
          setError("このアカウントでのログインは許可されていません。");
          return;
        }
      }
      
      setUser(currentUser);
      setAuthLoading(false);
      // ログイン時に履歴を取得
      if (currentUser) {
        fetchHistory(currentUser.uid);
      } else {
        setSearchHistory([]);
      }
    });

    // CRITICAL CONSTRAINT: Test connection to Firestore
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const userEmail = result.user.email;
      
      if (userEmail && !ALLOWED_EMAILS.includes(userEmail)) {
        // 初回ログイン時にホワイトリストに入っていなければ即座に制限
        // (注: 現在のアカウントを動的に許可するため、後ほど調整が必要な場合はお知らせください)
        await signOut(auth);
        setError(`ログイン権限がありません (${userEmail})。管理者に許可を依頼してください。`);
      }
    } catch (err: any) {
      console.error("Login failed", err);
      const detail = err.code ? `[${err.code}] ${err.message}` : (err.message || "不明なエラー");
      setError("ログインに失敗しました: " + detail);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Logout failed", err);
    }
  };

  const handleQuickSearch = (keyword: string) => {
    setQuery(keyword);
    // Since setQuery is asynchronous, we call a modified handleSearch logic or directly use the keyword
    performAPIRequest(keyword);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;
    performAPIRequest(query);
  };

  // ✨ 追加機能2: 関連する質問を提案する（ブログ記事に関連するもののみ）
  const generateFollowUpQuestions = async (currentAnswer: string, currentQuery: string) => {
    if (!currentAnswer) return;
    setIsSuggesting(true);
    const promptText = `ユーザーが「${currentQuery}」という質問をし、精神科医kyupinのブログ(ameblo.jp/kyupin/)の検索結果から以下の回答を得ました。\n\n回答: ${currentAnswer}\n\nこの回答内容を踏まえて、同じブログ内で見つかりそうな関連トピックに絞って、ユーザーが次に知りたくなりそうな深掘り質問を3つ提案してください。\n\n注意: 提案する質問は、精神科医のブログに実際に書かれていそうな内容に限定してください。一般的な医療質問は避けてください。`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        }
      });
      const text = response.text;
      if (text) {
        const questions = JSON.parse(text);
        setFollowUpQuestions(questions);
      }
    } catch (err) {
      console.error("Suggestion API Error:", err);
    } finally {
      setIsSuggesting(false);
    }
  };

  const performAPIRequest = async (searchQuery: string) => {
    setLoading(true);
    setError('');
    setAnswer('');
    setSources([]);
    setSimplifiedAnswer('');
    setFollowUpQuestions([]);

    const systemInstruction = `あなたは「精神科医kyupinのブログ（https://ameblo.jp/kyupin/）」の過去記事のみを知識源として回答するアシスタントです。

【絶対に守るべきルール】
1. Google検索ツールで検索する際、必ず「kyupin ブログ」というキーワードを質問内容と組み合わせて検索してください。
2. 検索結果のうち、URLに「ameblo.jp/kyupin」を含むページの情報のみを使用してください。それ以外のサイトの情報は完全に無視してください。
3. ameblo.jp/kyupinの記事が検索結果に1つもない場合は、「kyupinのブログ内にはこのテーマに関する記事は見つかりませんでした。」とだけ回答してください。一般的な医療情報の補足は行わないでください。
4. 一般的な情報源をもとに回答を作成しているのに「kyupinのブログによると」と嘘の出典を記述することは**絶対にやめてください**。
5. ブログ記事が見つかった場合は、その記事の内容に基づいて丁寧に回答し、参考にした記事のタイトルや要点を明記してください。
6. ユーザーの質問が口語的・曖昧でも、関連する医学用語や薬剤名を推測して検索を補強してください。`;

    // 「kyupin ブログ」を自然にキーワードに含めて検索精度を向上させる
    const promptText = `以下の質問について、「kyupin ブログ 精神科」と質問内容を組み合わせてGoogle検索を行ってください。検索結果のうち ameblo.jp/kyupin の記事のみを参照して回答してください。\n\n質問: ${searchQuery}`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: promptText,
        config: {
          systemInstruction: systemInstruction,
          tools: [{ googleSearch: {} }] as any,
          toolConfig: { includeServerSideToolInvocations: true } as any,
        }
      });

      const text = response.text;
      
      if (text) {
        setAnswer(text);
        
        // 元の回答が設定されたら、自動的に次の質問を生成
        generateFollowUpQuestions(text, searchQuery);
        
        // 参考元URL（グラウンディングデータ）の抽出と重複排除
        const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        const chunks = groundingMetadata?.groundingChunks;
        
        const uniqueSources: Source[] = [];
        const seenUris = new Set<string>();
        
        if (chunks) {
          chunks.forEach((chunk: any) => {
            const web = chunk.web;
            if (web?.uri && !seenUris.has(web.uri)) {
              seenUris.add(web.uri);
              uniqueSources.push({
                uri: web.uri,
                title: web.title || web.uri
              });
            }
          });
        }
        
        // Fallback to attributions if chunks are missing (legacy/other versions)
        if (uniqueSources.length === 0) {
          const rawSources = (groundingMetadata as any)?.groundingAttributions?.map((a: any) => ({
            uri: a.web?.uri,
            title: a.web?.title
          })) || [];
          
          for (const source of rawSources) {
            if (source.uri && !seenUris.has(source.uri)) {
              seenUris.add(source.uri);
              uniqueSources.push(source);
            }
          }
        }
        
        setSources(uniqueSources);
        
        // ログイン済みの場合、検索結果を履歴に保存
        saveToHistory(searchQuery, text, uniqueSources);
      } else {
        setAnswer("回答を生成できませんでした。");
      }
    } catch (err: any) {
      console.error("API Search Error:", err);
      setError("API呼び出しでエラーが発生しました。設定メニューでAPIキーが正しく設定されているか（または無料枠の上限に達していないか）をご確認ください。");
    } finally {
      setLoading(false);
    }
  };

  // ✨ 追加機能1: 回答をわかりやすく言い換える
  const handleSimplify = async () => {
    if (!answer) return;
    setIsSimplifying(true);
    const promptText = `以下の回答は精神科医kyupinのブログ記事に基づいていますが、専門用語が含まれていて難しい場合があります。医療知識のない一般の人にもわかりやすく、噛み砕いた表現で要約して説明し直してください。ただし、元のブログ記事の内容から逸脱しないでください。\n\n元の回答:\n${answer}`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          systemInstruction: "あなたは優しくてわかりやすい医療解説アシスタントです。元の回答の内容を正確に保ちつつ、やさしい言葉で言い換えてください。新しい情報の追加は行わないでください。",
        }
      });
      const text = response.text;
      if (text) setSimplifiedAnswer(text);
    } catch (err) {
      console.error("API Error:", err);
    } finally {
      setIsSimplifying(false);
    }
  };

  // ✨ コピー機能
  const handleCopy = async () => {
    const textToCopy = `【質問】\n${query}\n\n【回答】\n${answer}\n\n${simplifiedAnswer ? `【やさしい解説】\n${simplifiedAnswer}\n\n` : ''}【参考元】\n${sources.map(s => s.uri).join('\n')}`;
    
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  // ✨ 保存機能（テキストファイルとしてダウンロード）
  const handleDownload = () => {
    const textToSave = `【質問】\n${query}\n\n【回答】\n${answer}\n\n${simplifiedAnswer ? `【やさしい解説】\n${simplifiedAnswer}\n\n` : ''}【参考元】\n${sources.map(s => s.uri).join('\n')}`;
    const blob = new Blob([textToSave], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeQuery = query.replace(/[\\/:*?"<>|]/g, '_').substring(0, 15) || '質問結果';
    link.download = `ブログQA_${safeQuery}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-bg-dark text-slate-200 p-4 font-sans selection:bg-blue-500/30">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* ヘッダー部分 */}
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col lg:flex-row items-center justify-between gap-4 py-3 px-4"
        >
          <div className="flex items-center space-x-3 self-start lg:self-center">
            <div className="bg-blue-600 p-2 rounded-xl text-white shadow-lg shadow-blue-500/20 shrink-0">
              <BookOpen size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center whitespace-nowrap">
                Medical Blog Insights
              </h1>
              <p className="text-[10px] text-slate-500">精神科医kyupinブログ Q&A</p>
            </div>
          </div>

          <div className="flex-1 max-w-2xl w-full space-y-2">
            <form onSubmit={handleSearch} className="w-full">
              <div className="relative group">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors" size={16} />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="質問を入力..."
                  className="w-full bg-slate-900 border border-slate-700/50 rounded-xl py-2.5 pl-10 pr-16 text-sm focus:outline-none focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 transition-all shadow-inner"
                  disabled={loading}
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                  {loading ? (
                    <Loader2 size={14} className="animate-spin text-blue-500 mr-2" />
                  ) : (
                    <button
                      type="submit"
                      disabled={!query.trim()}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-[10px] font-bold rounded-lg transition-all active:scale-95"
                    >
                      質問
                    </button>
                  )}
                </div>
              </div>
            </form>
            
            {/* 次の質問提案ワード (回答生成後のみ表示) */}
            {followUpQuestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-1 py-1">
                <span className="text-[10px] text-emerald-500 uppercase tracking-widest font-black mr-2">
                  NEXT QUESTIONS:
                </span>
                {followUpQuestions.map((word) => (
                  <button
                    key={word}
                    onClick={() => handleQuickSearch(word)}
                    disabled={loading}
                    className="text-[10px] px-3 py-1 border rounded-full transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-medium bg-emerald-900/40 hover:bg-emerald-800/60 border-emerald-500/20 text-emerald-300 hover:text-emerald-100"
                  >
                    {word}
                  </button>
                ))}
                {isSuggesting && <Loader2 size={12} className="animate-spin text-emerald-500 ml-2" />}
              </div>
            )}
          </div>

          {/* Auth Button & 履歴ボタン */}
          <div className="flex items-center gap-2 self-end lg:self-center">
            {/* 履歴ボタン（ログイン済みのみ表示） */}
            {!authLoading && user && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="relative flex items-center gap-1 px-3 py-1.5 bg-slate-900/50 hover:bg-slate-800/80 text-slate-400 hover:text-blue-300 border border-slate-800 rounded-lg text-[10px] font-bold transition-all"
              >
                <History size={12} />
                <span>履歴</span>
                {searchHistory.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-blue-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">
                    {searchHistory.length > 9 ? '9+' : searchHistory.length}
                  </span>
                )}
              </button>
            )}
            {!authLoading && (
              user ? (
                <div className="flex items-center gap-2 bg-slate-900/50 p-1 pr-3 rounded-xl border border-slate-800">
                  <img 
                    src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} 
                    alt={user.displayName || "User"} 
                    className="w-7 h-7 rounded-lg object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="hidden xs:block text-left">
                    <p className="text-[9px] font-bold text-white truncate max-w-[80px] leading-tight">
                      {user.displayName || user.email}
                    </p>
                    <button 
                      onClick={handleLogout}
                      className="text-[8px] text-slate-500 hover:text-red-400 transition-colors uppercase font-black"
                    >
                      Logout
                    </button>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="xs:hidden text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <LogOut size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleLogin}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-600/30 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap"
                >
                  <LogIn size={14} />
                  ログイン
                </button>
              )
            )}
          </div>
        </motion.header>

        {/* 履歴スライドパネル */}
        <AnimatePresence>
          {showHistory && (
            <>
              {/* オーバーレイ背景 */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 z-40"
                onClick={() => setShowHistory(false)}
              />
              {/* パネル本体 */}
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed right-0 top-0 h-full w-[85%] sm:w-full sm:max-w-md bg-slate-950 border-l border-slate-800 z-50 flex flex-col shadow-2xl"
              >
                {/* パネルヘッダー */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <History size={16} className="text-blue-400" />
                    <h2 className="text-sm font-bold text-white">検索履歴</h2>
                    <span className="text-[10px] text-slate-500">({searchHistory.length}件)</span>
                  </div>
                  <button
                    onClick={() => setShowHistory(false)}
                    className="text-slate-500 hover:text-white transition-colors p-1"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* パネル本文 */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {historyLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 size={24} className="animate-spin text-blue-500" />
                    </div>
                  ) : searchHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-500 space-y-3">
                      <Clock size={32} className="opacity-30" />
                      <p className="text-xs">まだ検索履歴がありません</p>
                    </div>
                  ) : (
                    searchHistory.map((item) => (
                      <div
                        key={item.id}
                        className="relative group bg-slate-900/60 border border-slate-800 rounded-xl p-3 hover:border-blue-500/30 hover:bg-slate-900/80 transition-all"
                      >
                        <button
                          onClick={() => restoreFromHistory(item)}
                          className="w-full text-left"
                        >
                          <p className="text-xs font-bold text-slate-200 line-clamp-1 mb-1">{item.query}</p>
                          <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">{item.answer.substring(0, 100)}...</p>
                          <p className="text-[9px] text-slate-600 mt-2 flex items-center gap-1">
                            <Clock size={10} />
                            {item.createdAt.toLocaleDateString('ja-JP')} {item.createdAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteHistory(item.id); }}
                          className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all p-1"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* エラー表示 */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-red-400 text-sm mb-8"
            >
              <AlertCircle size={18} className="shrink-0" />
              <p className="flex-1">{error}</p>
              <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400">
                <X size={18} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

          {/* メインコンテンツエリア */}
          <main className="min-h-[60vh]">
            
            {/* メイン回答 (フル幅) */}
            <section className="flex flex-col space-y-6 max-w-4xl mx-auto">
              {!loading && answer ? (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="glass-panel flex-1 p-5 sm:p-10 relative overflow-hidden group shadow-2xl shadow-blue-900/10"
                >
                  {/* 装飾的なバッジ */}
                  <div className="hidden xs:block absolute top-4 sm:top-8 right-4 sm:right-10 text-[8px] sm:text-[10px] uppercase tracking-[0.2em] text-blue-400 font-black border border-blue-500/40 px-2.5 py-1 rounded-md pointer-events-none bg-blue-900/10">
                    AI GROUNDED RESPONSE
                  </div>

                  <div className="space-y-6 sm:space-y-8">
                    <div className="flex items-center gap-3 mb-4 sm:mb-6">
                      <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 bg-blue-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.6)]"></span>
                      <h2 className="text-[10px] sm:text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center whitespace-nowrap">
                        検索結果からの回答
                      </h2>
                    </div>

                  <div className="relative">
                    <FormattedText text={answer} />
                  </div>

                  {/* 参考元URLの表示 */}
                  {sources.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-slate-700/50 space-y-6">
                      
                      {/* ブログからの情報源 */}
                      {sources.filter(s => isBlogSource(s.uri)).length > 0 && (
                        <div className="space-y-4">
                          <h3 className="text-xs font-bold text-blue-400 uppercase flex items-center tracking-wider text-nowrap">
                            <BookOpen size={14} className="mr-2" />
                            情報源となったブログ記事
                          </h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {sources.filter(s => isBlogSource(s.uri)).map((source, index) => (
                              <a
                                key={`blog-${index}`}
                                href={source.uri}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 hover:underline bg-blue-50/5 p-3 rounded-xl border border-blue-500/30 transition-all hover:bg-blue-500/20 shadow-sm"
                              >
                                <span className="line-clamp-1">{source.title || source.uri}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* その他の検索で参照された情報源 */}
                      {sources.filter(s => !isBlogSource(s.uri)).length > 0 && (
                        <div className="space-y-4 pt-2">
                          <h3 className="text-xs font-bold text-slate-500 uppercase flex items-center tracking-wider text-nowrap">
                            <ExternalLink size={14} className="mr-2" />
                            検索で参照された情報源
                          </h3>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {sources.filter(s => !isBlogSource(s.uri)).map((source, index) => (
                              <a
                                key={`ext-${index}`}
                                href={source.uri}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 hover:underline bg-slate-800/50 p-3 rounded-xl border border-slate-700 transition-all hover:bg-slate-700"
                              >
                                <span className="line-clamp-1">{source.title || source.uri}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 深掘りヒント (動的に生成された次の質問) */}
                  {(followUpQuestions.length > 0 || isSuggesting) && (
                    <div className="mt-8 pt-6 border-t border-slate-700/50 space-y-4">
                      <h3 className="text-xs font-bold text-emerald-400 uppercase flex items-center tracking-wider text-nowrap">
                        <HelpCircle size={14} className="mr-2" />
                        深掘りヒント
                      </h3>
                      {isSuggesting ? (
                        <div className="flex items-center gap-3 py-2 px-1">
                          <Loader2 size={14} className="animate-spin text-emerald-500" />
                          <span className="text-xs text-slate-500 animate-pulse">次の質問を考えています...</span>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {followUpQuestions.map((q, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleQuickSearch(q)}
                              className="text-left px-4 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-xs text-slate-300 hover:text-emerald-300 hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-all flex items-center justify-between group"
                            >
                              <span className="font-medium">{q}</span>
                              <ChevronRight size={12} className="ml-2 text-slate-600 group-hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-all" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* アクションボタン */}
                <div className="flex flex-col sm:flex-row items-center gap-3 mt-6 sm:mt-10 pt-6 sm:pt-8 border-t border-white/5">
                  <button
                    onClick={handleCopy}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-800/60 hover:bg-slate-700/80 text-slate-200 border border-white/5 rounded-xl text-xs font-bold transition-all shadow-lg active:scale-95"
                  >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={16} className="text-slate-400" />}
                    {copied ? "コピー完了" : "結果をコピー"}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-800/60 hover:bg-slate-700/80 text-slate-200 border border-white/5 rounded-xl text-xs font-bold transition-all shadow-lg active:scale-95"
                  >
                    <Download size={16} className="text-slate-400" />
                    保存する
                  </button>
                </div>
              </motion.div>
            ) : !loading && !answer ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 space-y-8 py-12">
                <div className="flex flex-col items-center space-y-4 opacity-50">
                  <div className="w-20 h-20 bg-slate-900/80 rounded-full flex items-center justify-center border border-slate-700/50 shadow-inner">
                    <Search size={36} className="text-slate-600" />
                  </div>
                  <p className="text-sm font-medium tracking-wide">自由に質問してブログ記事を検索できます</p>
                </div>

                {/* 質問の例文 */}
                <div className="space-y-3 w-full max-w-lg px-2">
                  <p className="text-[9px] text-slate-500 uppercase tracking-[0.2em] font-bold text-center">こんな質問ができます</p>
                  <div className="flex flex-col gap-2">
                    {EXAMPLE_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        onClick={() => handleQuickSearch(q)}
                        disabled={loading}
                        className="text-left px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl bg-slate-900/60 border border-slate-700/30 text-[11px] sm:text-xs text-slate-400 hover:text-blue-300 hover:bg-slate-800/80 hover:border-blue-500/20 transition-all flex items-center justify-between group"
                      >
                        <span className="flex items-center gap-2">
                          <MessageCircle size={10} className="text-slate-600 group-hover:text-blue-400 shrink-0" />
                          {q}
                        </span>
                        <ChevronRight size={12} className="text-slate-700 group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* キーワードカテゴリ */}
                <div className="space-y-4 w-full max-w-lg px-2 pb-10">
                  <p className="text-[9px] text-slate-500 uppercase tracking-[0.2em] font-bold text-center">キーワードから探す</p>
                  {KEYWORD_CATEGORIES.map((category) => (
                    <div key={category.label} className="space-y-2">
                      <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider px-1">{category.label}</p>
                      <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {category.keywords.map((keyword) => (
                          <button
                            key={keyword}
                            onClick={() => handleQuickSearch(keyword)}
                            disabled={loading}
                            className="text-[10px] sm:text-[11px] px-2.5 py-1 sm:px-3 sm:py-1.5 border rounded-full transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed font-medium bg-blue-900/20 hover:bg-blue-800/40 border-blue-500/15 text-blue-300/80 hover:text-blue-200"
                          >
                            {keyword}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {loading && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass-panel flex-1 flex flex-col items-center justify-center space-y-6 py-20"
              >
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full"></div>
                  <Loader2 size={48} className="animate-spin text-blue-500 relative z-10" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-sm font-medium text-slate-300 animate-pulse">ブログの過去記事を検索中...</p>
                  <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em]">Analyzing Archives</p>
                </div>
              </motion.div>
            )}
           </section>
        </main>
      </div>

      <footer className="max-w-7xl mx-auto mt-12 mb-12 text-center border-t border-white/5 pt-12">
        <div className="text-slate-600 font-bold text-[10px] uppercase tracking-[0.4em] mb-4">
          Internal Health Knowledge Base
        </div>
      </footer>
    </div>
  );
}
