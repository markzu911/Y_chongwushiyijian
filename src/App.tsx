import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, AlertCircle, RefreshCw, Camera, Image as ImageIcon, Download } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function parseBase64(dataUrl: string): [string, string] {
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    throw new Error("Invalid base64 Data URL");
  }
  return [matches[1], matches[2]];
}

type ImageSize = "1K" | "2K" | "4K";
type AspectRatio = "1:1" | "3:4" | "4:3";

export default function App() {
  const [petImage, setPetImage] = useState<string | null>(null);
  const [clothImage, setClothImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<(string | null)[]>([]);
  const [resolution, setResolution] = useState<ImageSize>("1K");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [error, setError] = useState<string | null>(null);
  const [integral, setIntegral] = useState<number | null>(null);
  const [saasInfo, setSaasInfo] = useState<{userId: string, toolId: string} | null>(null);

  useEffect(() => {
    const initSaaS = async (info: {userId: string, toolId: string}) => {
      try {
        const res = await fetch('/api/tool/launch', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(info)
        });
        const d = await res.json();
        if (d.success && d.data?.user?.integral !== undefined) {
          setIntegral(d.data.user.integral);
        }
      } catch(e) {
        console.error("SaaS launch error:", e);
      }
    };

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'SAAS_INIT') {
        const { userId, toolId } = e.data;
        setSaasInfo({ userId, toolId });
        initSaaS({ userId, toolId });
      }
    };
    window.addEventListener('message', handleMessage);

    const to = setTimeout(() => {
      setSaasInfo((prev) => {
        if (!prev) {
           const mockInfo = { userId: "test_user", toolId: "pet_tool" };
           initSaaS(mockInfo);
           return mockInfo;
        }
        return prev;
      });
    }, 1000);
    
    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(to);
    };
  }, []);

  const handleImageUpload = (file: File, type: 'pet' | 'cloth') => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = e.target?.result as string;
      if (type === 'pet') {
        setPetImage(b64);
      } else {
        setClothImage(b64);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!petImage || !clothImage) return;
    setIsGenerating(true);
    setResults([]);
    setError(null);

    if (saasInfo) {
      try {
        const verifyRes = await fetch('/api/tool/verify', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(saasInfo)
        });
        const vData = await verifyRes.json();
        if (vData.success === false) {
           setError(vData.message || "积分不足");
           setIsGenerating(false);
           return;
        }
        // If verify success, update integral if returned
        if (vData.data?.currentIntegral !== undefined) {
          setIntegral(vData.data.currentIntegral);
        }
      } catch (e) {
        console.warn("Verify request failed, continuing...", e);
      }
    }

    const translateError = (errObj: any): string => {
      const errStr = errObj?.message || errObj?.toString() || "未知错误";
      if (errStr.includes('503') || errStr.includes('high demand') || errStr.includes('UNAVAILABLE')) {
        return "AI模型当前访问量过大，请稍后刷新页面再次尝点击生成尝试。";
      }
      if (errStr.includes('API key')) {
         return "API 密钥无效，请检查您的配置。";
      }
      if (errObj instanceof Error) {
        return errObj.message;
      }
      return errStr;
    }

    try {
      const [petMime, petB64] = parseBase64(petImage);
      const [clothMime, clothB64] = parseBase64(clothImage);

      // Verify if pet is a cat or dog first
      const checkPrompt = `Is the subject in this image a real cat or a real dog? Respond with a JSON object containing a single boolean field "isCatOrDog" set to true if it is a real cat or dog, and false otherwise.`;
      
      const checkResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            { text: checkPrompt },
            { inlineData: { data: petB64, mimeType: petMime } }
          ]
        },
        config: {
          responseMimeType: "application/json"
        }
      });
      
      const checkResultText = checkResponse.text || "{}";
      const checkResultObj = JSON.parse(checkResultText);
      if (checkResultObj.isCatOrDog === false) {
        throw new Error("只能上传猫或狗的图片");
      }

      const unifiedEnvironment = "ENVIRONMENT: The pet is sitting in a warm, cozy, and inviting indoor home setting, resting on a soft plush beige blanket or cushion. The beautifully blurred background features subtle warm wooden textures and soft glowing ambient light. Highly detailed, soft realistic warm indoor lighting.";
      const exactIdentity = "CRITICAL INSTRUCTION: You MUST perfectly duplicate the pet's identity from the 'Reference Pet Image'. The fur color, fur pattern, eye color, face shape, coat texture, and breed features must remain EXACTLY the same. DO NOT change or hallucinate any of the pet's original physical traits. The final image MUST look precisely like the reference pet.";
      const exactClothing = "CRITICAL CLOTHING INSTRUCTION: You MUST perfectly duplicate the clothing item from the 'Reference Clothing Image'. Pay strict attention to the FABRIC TEXTURE, material, fluffiness, woven details, cut, structure, collar, and sleeve length. If the reference clothing is made of fluffy/fleece/plush material, the generated clothing MUST showcase that exact same fluffy/plush texture. DO NOT add sleeves if the reference clothing is sleeveless (e.g., a vest or tank top). The clothing must be an EXACT 1:1 match in appearance and material feel, fitted perfectly to the pet.";
      const prompts = [
         `Create a highly detailed photograph of the exact same pet from the Reference Pet Image. ${exactIdentity} ${exactClothing} POSING AND ANGLE: The pet is in an adorable sitting pose with its front paws resting softly in front of it. Its body is turned at a slight 3/4 angle, but its head is turned perfectly to face the front, looking slightly upward directly into the camera with large, cute, expressive eyes. ${unifiedEnvironment}`,
         `Create a highly detailed photograph of the exact same pet from the Reference Pet Image. ${exactIdentity} ${exactClothing} POSING AND ANGLE: The pet is sitting mostly facing away from the camera, clearly showcasing the entire back design and patterns of the clothing item. The pet's head is turned back gracefully over its shoulder, looking adorably back up at the camera. ${unifiedEnvironment}`
      ];

      // Initialize results with nulls so the loading indicators appear for all cards
      const currentResults: (string | null)[] = [null, null];
      setResults([...currentResults]);

      let hasGenerationError = false;

      for (let i = 0; i < prompts.length; i++) {
        try {
            const resp = await ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: {
                parts: [
                { text: prompts[i] },
                { text: "Reference Pet Image:" },
                { inlineData: { data: petB64, mimeType: petMime } },
                { text: "Reference Clothing Image:" },
                { inlineData: { data: clothB64, mimeType: clothMime } }
                ]
            },
            config: {
                imageConfig: {
                    aspectRatio: aspectRatio
                }
            }
            });
            
            const parts = resp?.candidates?.[0]?.content?.parts || [];
            let generatedImageBase64 = null;
            let generatedMime = "image/png";

            for (const p of parts) {
                if (p.inlineData) {
                    generatedImageBase64 = p.inlineData.data;
                    generatedMime = p.inlineData.mimeType || "image/png";
                    break;
                }
            }

            if (generatedImageBase64) {
               currentResults[i] = `data:${generatedMime};base64,${generatedImageBase64}`;
               
               // Consume points if back image (index 1) successful
               if (i === 1 && saasInfo) {
                 try {
                   fetch('/api/tool/consume', {
                     method: "POST",
                     headers: { "Content-Type": "application/json" },
                     body: JSON.stringify(saasInfo)
                   }).then(res => res.json()).then(d => {
                     if (d.success && d.data?.currentIntegral !== undefined) {
                       setIntegral(d.data.currentIntegral);
                     }
                   }).catch(e => console.warn("Consume error", e));
                 } catch(err) {}
               }
            }
        } catch (e) {
            console.error(`Error generating image ${i}:`, e);
            hasGenerationError = true;
            setError(translateError(e));
        }
        
        // Update the results state immediately after each image is computed
        setResults([...currentResults]);
      }
      
      if (hasGenerationError) {
        throw new Error("部分图片生成失败，模型当前承载量过高，请稍后再试。");
      }
    } catch (err: any) {
      if (err.message !== "部分图片生成失败，模型当前承载量过高，请稍后再试。") {
        setError(translateError(err));
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex h-[100dvh] w-full bg-bg-base text-text-main font-sans overflow-hidden mx-auto max-w-[1400px] relative">
      {integral !== null && (
        <div className="absolute top-6 right-6 bg-accent text-white px-4 py-2 rounded-full text-[14px] font-[600] shadow-sm flex items-center gap-2 z-50">
          <Sparkles className="w-4 h-4" />
          积分余额: {integral}
        </div>
      )}
      <aside className="w-[320px] bg-sidebar border-r border-border p-6 flex flex-col gap-6 overflow-y-auto shrink-0 shadow-sm relative z-10 hidden md:flex">
        <div className="text-[24px] font-[700] text-accent tracking-[-0.5px] items-center gap-2 flex">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 5.172a2 2 0 0 0-1.414.586l-1.172 1.172A2 2 0 0 1 6 7.5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-10a2 2 0 0 0-2-2h-2a2 2 0 0 1-1.414-.586l-1.172-1.172A2 2 0 0 0 14 5.172h-4Z"/>
            <circle cx="12" cy="13" r="3"/>
          </svg>
          宠物试衣间
        </div>

        <div className="flex flex-col gap-3">
          {error && (
            <div className="mt-2 p-3 bg-red-50 text-red-600 rounded-[8px] flex gap-2 text-[12px] border border-red-100">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-[12px] uppercase tracking-[1px] text-text-muted font-[600]">输出设置 (分辨率)</div>
          <div className="grid grid-cols-3 gap-2">
            {(["1K", "2K", "4K"] as ImageSize[]).map(res => (
              <button key={res} onClick={() => setResolution(res)}
                className={`border p-[8px] rounded-[8px] text-[13px] text-center cursor-pointer transition-colors ${resolution === res ? 'border-accent bg-active-bg text-accent font-[600]' : 'border-border bg-white text-text-main hover:border-accent/50'}`}>
                {res}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-[12px] uppercase tracking-[1px] text-text-muted font-[600]">画面比例</div>
          <div className="grid grid-cols-3 gap-2">
            {(["1:1", "3:4", "4:3"] as AspectRatio[]).map(ar => (
              <button key={ar} onClick={() => setAspectRatio(ar)}
                className={`border p-[8px] rounded-[8px] text-[13px] text-center cursor-pointer transition-colors ${aspectRatio === ar ? 'border-accent bg-active-bg text-accent font-[600]' : 'border-border bg-white text-text-main hover:border-accent/50'}`}>
                {ar}
              </button>
            ))}
          </div>
        </div>

        <button 
          onClick={handleGenerate} 
          disabled={!petImage || !clothImage || isGenerating}
          className="mt-auto bg-accent text-white border-none p-[16px] rounded-[12px] text-[16px] font-[600] cursor-pointer transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isGenerating && <RefreshCw className="animate-spin w-5 h-5" />}
          {isGenerating ? '生成中...' : '一键生成宠物写真'}
        </button>
      </aside>

      <main className="flex-1 p-8 flex flex-col gap-6 overflow-y-auto w-full md:w-auto h-full pb-32 md:pb-8">
        <div className="md:hidden text-[24px] font-[700] text-accent tracking-[-0.5px] items-center gap-2 mb-2 flex">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 5.172a2 2 0 0 0-1.414.586l-1.172 1.172A2 2 0 0 1 6 7.5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-10a2 2 0 0 0-2-2h-2a2 2 0 0 1-1.414-.586l-1.172-1.172A2 2 0 0 0 14 5.172h-4Z"/>
            <circle cx="12" cy="13" r="3"/>
          </svg>
          宠物试衣间
        </div>

        <div className="flex flex-col sm:flex-row gap-[20px] lg:h-[220px] shrink-0">
          <UploadBox 
            title="宠物照片" 
            desc="支持 JPG, PNG (最大 10MB)"
            icon="🐕"
            image={petImage} 
            onUpload={(f) => handleImageUpload(f, 'pet')} 
            onRemove={() => { setPetImage(null); }}
          />
          <UploadBox 
            title="服装照片" 
            desc="支持 JPG, PNG (最大 10MB)"
            icon="👕"
            image={clothImage} 
            onUpload={(f) => handleImageUpload(f, 'cloth')} 
            onRemove={() => { setClothImage(null); }}
          />
        </div>

        <div className="mt-2 flex-1 flex flex-col gap-[12px]">
          <div className="text-[12px] uppercase tracking-[1px] text-text-muted font-[600]">预览生成结果</div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-[20px] flex-1 min-h-[300px]">
            <ResultCard title="宠物试穿正面图" badge="FRONT" desc="正面视觉效果" active={isGenerating && !results[0]} src={results[0]} icon={isGenerating && !results[0] ? <RefreshCw className="w-8 h-8 animate-spin text-accent"/> : <ImageIcon className="w-12 h-12 opacity-20" />} />
            <ResultCard title="宠物试穿背面图" badge="BACK" desc="背面及回眸效果" active={isGenerating && !results[1]} src={results[1]} icon={isGenerating && !results[1] ? <RefreshCw className="w-8 h-8 animate-spin text-accent"/> : <ImageIcon className="w-12 h-12 opacity-20" />} />
          </div>
        </div>

        <div className="md:hidden flex flex-col gap-6 mt-4">
           <div className="flex flex-col gap-3">
             <div className="text-[12px] uppercase tracking-[1px] text-text-muted font-[600]">输出设置 (分辨率)</div>
             <div className="grid grid-cols-3 gap-2">
              {(["1K", "2K", "4K"] as ImageSize[]).map(res => (
                <button key={`m-${res}`} onClick={() => setResolution(res)}
                  className={`border bg-white p-[8px] rounded-[8px] text-[13px] text-center cursor-pointer transition-colors ${resolution === res ? 'border-accent bg-active-bg text-accent font-[600]' : 'border-border text-text-main hover:border-accent/50'}`}>
                  {res}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
             <div className="text-[12px] uppercase tracking-[1px] text-text-muted font-[600]">画面比例</div>
             <div className="grid grid-cols-3 gap-2">
              {(["1:1", "3:4", "4:3"] as AspectRatio[]).map(ar => (
                <button key={`mar-${ar}`} onClick={() => setAspectRatio(ar)}
                  className={`border bg-white p-[8px] rounded-[8px] text-[13px] text-center cursor-pointer transition-colors ${aspectRatio === ar ? 'border-accent bg-active-bg text-accent font-[600]' : 'border-border text-text-main hover:border-accent/50'}`}>
                  {ar}
                </button>
              ))}
            </div>
          </div>

          <button 
            onClick={handleGenerate} 
            disabled={!petImage || !clothImage || isGenerating}
            className="w-full bg-accent text-white border-none p-[16px] rounded-[12px] text-[16px] font-[600] cursor-pointer transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4 shadow-sm"
          >
            {isGenerating && <RefreshCw className="animate-spin w-5 h-5" />}
            {isGenerating ? '生成中...' : '一键生成宠物写真'}
          </button>
        </div>

      </main>
    </div>
  );
}

function UploadBox({ title, desc, icon, image, onUpload, onRemove }: { title: string, desc: string, icon: string, image: string | null, onUpload: (f: File) => void, onRemove: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div 
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => !image && fileInputRef.current?.click()}
      className={`flex-1 border-2 border-dashed rounded-[16px] flex flex-col items-center justify-center bg-card text-text-muted text-center relative overflow-hidden transition-all h-[220px] sm:h-auto
        ${image ? 'border-transparent' : 'border-border hover:border-accent/50 cursor-pointer'}`}
    >
      {image ? (
        <>
          <img src={image} alt={title} className="w-full h-full object-contain p-2" />
          <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
            <button 
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="px-4 py-2 bg-white/90 text-text-main text-sm font-[500] rounded-[8px] hover:bg-white transition-colors shadow-sm"
            >
              移除照片
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center p-4">
          <div className="text-[40px] mb-[12px] opacity-50 select-none">{icon}</div>
          <div className="text-[16px] text-text-main font-medium">{title}</div>
          <div className="text-[11px] mt-[4px]">{desc}</div>
        </div>
      )}
      <input 
        type="file" 
        ref={fileInputRef} 
        accept="image/*" 
        onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} 
        className="hidden" 
      />
    </div>
  );
}

function ResultCard({ title, badge, desc, active, src, icon }: { title: string, badge: string, desc: string, active: boolean, src?: string | null, icon: React.ReactNode }) {
  const handleDownload = () => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = `${title.replace(/\s+/g, '_')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="bg-card rounded-[16px] border border-border flex flex-col overflow-hidden h-[300px] lg:h-auto lg:min-h-[300px] group relative">
      <div className="flex-1 bg-tag flex items-center justify-center relative">
        <span className="absolute top-[12px] left-[12px] bg-white/90 px-[8px] py-[4px] rounded-[4px] text-[11px] font-[600] text-accent z-10 shadow-sm">
          {badge}
        </span>
        {src && (
          <button 
            onClick={handleDownload}
            className="absolute top-[12px] right-[12px] z-10 bg-white/90 text-accent p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 hover:bg-white shadow-sm"
            title="Download Image"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
        {src ? (
          <img src={src} alt={title} className="w-full h-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-3">
             {icon}
             {!active && <div className="text-text-muted opacity-40 text-[14px] font-[500]">{desc}</div>}
          </div>
        )}
      </div>
      <div className="p-[12px] text-[14px] text-center font-[500] border-t border-border bg-card text-text-main shrink-0">
        {title}
      </div>
    </div>
  );
}
