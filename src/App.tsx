import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, AlertCircle, RefreshCw, Camera, Image as ImageIcon, Download } from 'lucide-react';
import heic2any from "heic2any";

async function generateGeminiContent(options: { model: string, contents: any, config?: any }) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Generation failed");
  }
  return res.json();
}

const compressImage = (base64: string, maxWidth = 1600, quality = 0.85): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxWidth) {
          width *= maxWidth / height;
          height = maxWidth;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context failed'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = (err) => reject(err);
  });
};

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
  const [saasInfo, setSaasInfo] = useState<{userId: string, toolId: string, context?: string, prompt?: string[]} | null>(null);

  useEffect(() => {
    const initSaaS = async (info: {userId: string, toolId: string}) => {
      try {
        const res = await fetch('/api/tool/launch', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(info)
        });
        const d = await res.json();
        if (d.success !== false && d.data?.user?.integral !== undefined) {
          setIntegral(d.data.user.integral);
        }
      } catch(e) {
        console.error("SaaS launch error:", e);
      }
    };

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'SAAS_INIT') {
        const { userId, toolId, context, prompt } = e.data;
        if (String(userId) === "null" || String(userId) === "undefined" || 
            String(toolId) === "null" || String(toolId) === "undefined") {
            return;
        }
        setSaasInfo({ userId, toolId, context, prompt });
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

  const handleImageUpload = async (file: File, type: 'pet' | 'cloth') => {
    let imageFile = file;

    // Handle HEIC/HEIF conversion
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif' || 
                   file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
    
    if (isHeic) {
      try {
        const converted = await heic2any({
          blob: file,
          toType: "image/jpeg",
          quality: 0.8
        });
        const blob = Array.isArray(converted) ? converted[0] : converted;
        imageFile = new File([blob], file.name.split('.')[0] + '.jpg', { type: 'image/jpeg' });
      } catch (err) {
        console.error("HEIC conversion error:", err);
      }
    }

    if (!imageFile.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const b64 = e.target?.result as string;
      try {
        const compressed = await compressImage(b64);
        if (type === 'pet') {
          setPetImage(compressed);
        } else {
          setClothImage(compressed);
        }
      } catch (err) {
        console.error("Compression error:", err);
        // Fallback to original if compression fails
        if (type === 'pet') {
          setPetImage(b64);
        } else {
          setClothImage(b64);
        }
      }
    };
    reader.readAsDataURL(imageFile);
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
          body: JSON.stringify({ userId: saasInfo.userId, toolId: saasInfo.toolId })
        });
        const vData = await verifyRes.json();
        if (vData.success === false || vData.error) {
           setError(vData.error || vData.message || "积分不足");
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
      
      const checkResponse = await generateGeminiContent({
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
      
      const checkResultText = checkResponse.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const checkResultObj = JSON.parse(checkResultText);
      if (checkResultObj.isCatOrDog === false) {
        throw new Error("只能上传猫或狗的图片");
      }

      const unifiedEnvironment = "ENVIRONMENT: The pet is sitting in a warm, cozy, and inviting indoor home setting, resting on a soft plush beige blanket or cushion. The beautifully blurred background features subtle warm wooden textures and soft glowing ambient light. Highly detailed, soft realistic warm indoor lighting.";
      const exactIdentity = "ABSOLUTE CRITICAL INSTRUCTION: THIS IS A VIRTUAL TRY-ON TASK. The pet in the final image MUST BE A PERFECT 100% COPY of the 'Reference Pet Image'. The pet's face, fur pattern, specific fur colors, spots, eye shape, eye color, nose shape, and bodily proportions must be 100% IDENTICAL. Treat the Reference Pet Image as a strict subject character. DO NOT alter even a single hair or whisker of the original pet. It must look exactly like the uploaded pet.";
      const exactClothing = "CRITICAL CLOTHING INSTRUCTION: You MUST perfectly apply the clothing item from the 'Reference Clothing Image' to the pet. The 'Reference Clothing Image' typically shows the decorative BACK side (the part that covers the pet's spine). You must accurately represent the FABRIC TEXTURE, material, fluffiness, and woven details. DO NOT add sleeves if the reference is sleeveless. The clothing must fit the pet perfectly and look like a real garment, not a flat overlay.";
      
      const saasContextStr = saasInfo?.context ? ` ${saasInfo.context}` : "";
      const saasKeywordsStr = (saasInfo?.prompt && saasInfo.prompt.length > 0) ? ` ${saasInfo.prompt.join(',')}` : "";
      const additionalConstraints = saasContextStr + saasKeywordsStr;

      const prompts = [
         `${exactIdentity} ${exactClothing} TASK: Create a highly detailed photograph.${additionalConstraints} VIEW: FRONT VIEW. The pet is sitting facing the camera. This view MUST show the FRONT (BELLY/CHEST) side of the clothing. Usually the belly side is simpler than the back side shown in the reference. Ensure the clothing wraps around the pet's chest naturally. POSING: The pet is in an adorable sitting pose, looking directly into the camera with cute expressive eyes. ${unifiedEnvironment}`,
         `${exactIdentity} ${exactClothing} TASK: Create a highly detailed photograph.${additionalConstraints} VIEW: BACK VIEW. The pet is sitting facing AWAY from the camera. This view MUST show the BACK (SPINE/DECORATIVE) side of the clothing, which should be a 1:1 match to the design in the 'Reference Clothing Image'. POSING: The pet is sitting with its back to the lens, but its head is turned back gracefully over its shoulder to look at the camera. ${unifiedEnvironment}`
      ];

      // Initialize results with nulls so the loading indicators appear for all cards
      const currentResults: (string | null)[] = [null, null];
      setResults([...currentResults]);

      let hasGenerationError = false;

      for (let i = 0; i < prompts.length; i++) {
        try {
            const resp = await generateGeminiContent({
            model: "gemini-3.1-flash-image-preview",
            contents: {
                parts: [
                { text: "Subject to preserve EXACTLY (Reference Pet Image):" },
                { inlineData: { data: petB64, mimeType: petMime } },
                { text: "Clothing to wear EXACTLY (Reference Clothing Image):" },
                { inlineData: { data: clothB64, mimeType: clothMime } },
                { text: prompts[i] }
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
                     body: JSON.stringify({ userId: saasInfo.userId, toolId: saasInfo.toolId })
                   }).then(res => res.json()).then(d => {
                     if (d.success !== false && d.data?.currentIntegral !== undefined) {
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
        <div className="absolute top-6 right-6 bg-accent text-white px-4 py-2 flex items-center gap-2 rounded-full text-[13px] font-[600] shadow-sm z-50 transition-all">
          <Sparkles className="w-4 h-4" />
          积分余额: {integral}
        </div>
      )}
      <aside className="w-[320px] bg-sidebar border-r border-border p-6 flex flex-col gap-6 overflow-y-auto shrink-0 relative z-10 hidden md:flex">
        <div className="text-[22px] font-[700] text-accent tracking-[-1px] items-center gap-2 flex uppercase">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 5.172a2 2 0 0 0-1.414.586l-1.172 1.172A2 2 0 0 1 6 7.5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-10a2 2 0 0 0-2-2h-2a2 2 0 0 1-1.414-.586l-1.172-1.172A2 2 0 0 0 14 5.172h-4Z"/>
            <circle cx="12" cy="13" r="3"/>
          </svg>
          试衣间
        </div>

        <div className="flex flex-col gap-3">
          {error && (
            <div className="mt-2 p-3 bg-red-50 text-red-600 rounded-xl flex gap-2 text-[12px] border border-red-100">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-[11px] uppercase tracking-[2px] text-text-muted font-[700]">输出设置</div>
          <div className="grid grid-cols-3 gap-2">
            {(["1K", "2K", "4K"] as ImageSize[]).map(res => (
              <button key={res} onClick={() => setResolution(res)}
                className={`border p-[8px] rounded-xl text-[12px] text-center cursor-pointer transition-all ${resolution === res ? 'border-accent bg-accent text-white font-[600]' : 'border-border bg-white text-text-main hover:border-accent'}`}>
                {res}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-[11px] uppercase tracking-[2px] text-text-muted font-[700]">画面比例</div>
          <div className="grid grid-cols-3 gap-2">
            {(["1:1", "3:4", "4:3"] as AspectRatio[]).map(ar => (
              <button key={ar} onClick={() => setAspectRatio(ar)}
                className={`border p-[8px] rounded-xl text-[12px] text-center cursor-pointer transition-all ${aspectRatio === ar ? 'border-accent bg-accent text-white font-[600]' : 'border-border bg-white text-text-main hover:border-accent'}`}>
                {ar}
              </button>
            ))}
          </div>
        </div>

        <button 
          onClick={handleGenerate} 
          disabled={!petImage || !clothImage || isGenerating}
          className="mt-auto bg-accent text-white border border-accent p-[16px] rounded-xl text-[14px] font-[700] uppercase tracking-[1px] cursor-pointer transition-all hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isGenerating && <RefreshCw className="animate-spin w-4 h-4" />}
          {isGenerating ? '处理中' : '开始生成 写真'}
        </button>
      </aside>

      <main className="flex-1 p-8 flex flex-col gap-8 overflow-y-auto w-full md:w-auto h-full pb-32 md:pb-8">
        <div className="md:hidden text-[22px] font-[700] text-accent tracking-[-1px] items-center gap-2 mb-4 flex uppercase">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 5.172a2 2 0 0 0-1.414.586l-1.172 1.172A2 2 0 0 1 6 7.5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-10a2 2 0 0 0-2-2h-2a2 2 0 0 1-1.414-.586l-1.172-1.172A2 2 0 0 0 14 5.172h-4Z"/>
            <circle cx="12" cy="13" r="3"/>
          </svg>
          试衣间
        </div>

        <div className="flex flex-col sm:flex-row gap-[24px] lg:h-[240px] shrink-0">
          <UploadBox 
            title="宠物照片" 
            desc="支持 JPG, PNG, WebP, HEIC (最大 20MB)"
            icon="🐕"
            image={petImage} 
            onUpload={(f) => handleImageUpload(f, 'pet')} 
            onRemove={() => { setPetImage(null); }}
          />
          <UploadBox 
            title="服装照片" 
            desc="支持 JPG, PNG, WebP, HEIC (最大 20MB)"
            icon="👕"
            image={clothImage} 
            onUpload={(f) => handleImageUpload(f, 'cloth')} 
            onRemove={() => { setClothImage(null); }}
          />
        </div>

        <div className="mt-4 flex-1 flex flex-col gap-[16px]">
          <div className="text-[11px] uppercase tracking-[2px] text-text-muted font-[700]">结果预览</div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-[24px] flex-1 min-h-[350px]">
            <ResultCard title="正面视角" badge="正面" desc="正面效果" active={isGenerating && !results[0]} src={results[0]} icon={isGenerating && !results[0] ? <RefreshCw className="w-6 h-6 animate-spin text-black"/> : <ImageIcon className="w-10 h-10 opacity-10" />} />
            <ResultCard title="背面视角" badge="背面" desc="背面效果" active={isGenerating && !results[1]} src={results[1]} icon={isGenerating && !results[1] ? <RefreshCw className="w-6 h-6 animate-spin text-black"/> : <ImageIcon className="w-10 h-10 opacity-10" />} />
          </div>
        </div>

        <div className="md:hidden flex flex-col gap-6 mt-6">
           <div className="flex flex-col gap-3">
             <div className="text-[11px] uppercase tracking-[2px] text-text-muted font-[700]">分辨率</div>
             <div className="grid grid-cols-3 gap-2">
              {(["1K", "2K", "4K"] as ImageSize[]).map(res => (
                <button key={`m-${res}`} onClick={() => setResolution(res)}
                  className={`border bg-white p-[8px] rounded-xl text-[12px] text-center cursor-pointer transition-all ${resolution === res ? 'border-accent bg-accent text-white font-[600]' : 'border-border text-text-main hover:border-accent'}`}>
                  {res}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-3">
             <div className="text-[11px] uppercase tracking-[2px] text-text-muted font-[700]">比例</div>
             <div className="grid grid-cols-3 gap-2">
              {(["1:1", "3:4", "4:3"] as AspectRatio[]).map(ar => (
                <button key={`mar-${ar}`} onClick={() => setAspectRatio(ar)}
                  className={`border bg-white p-[10px] rounded-xl text-[12px] text-center cursor-pointer transition-all ${aspectRatio === ar ? 'border-accent bg-accent text-white font-[600]' : 'border-border text-text-main hover:border-accent'}`}>
                  {ar}
                </button>
              ))}
            </div>
          </div>

          <button 
            onClick={handleGenerate} 
            disabled={!petImage || !clothImage || isGenerating}
            className="w-full bg-accent text-white border border-accent p-[16px] rounded-xl text-[14px] font-[700] uppercase tracking-[1px] cursor-pointer transition-all hover:bg-accent-hover disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4 shadow-xl"
          >
            {isGenerating && <RefreshCw className="animate-spin w-4 h-4" />}
            {isGenerating ? '生成中' : '一键生成 写真'}
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
      className={`flex-1 border border-dashed rounded-2xl flex flex-col items-center justify-center bg-card text-text-muted text-center relative overflow-hidden transition-all h-[240px] sm:h-auto
        ${image ? 'border-transparent' : 'border-border hover:border-accent cursor-pointer'}`}
    >
      {image ? (
        <>
          <img src={image} alt={title} className="w-full h-full object-contain p-4" />
          <div className="absolute inset-0 bg-white/60 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center blur-backdrop">
            <button 
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="px-6 py-2 bg-accent text-white text-[12px] font-[700] uppercase tracking-[1px] rounded-xl hover:bg-accent-hover transition-all border border-accent"
            >
              移除照片
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center p-4">
          <div className="text-[32px] mb-[12px] grayscale select-none">{icon}</div>
          <div className="text-[12px] text-text-main font-bold uppercase tracking-[1px]">{title}</div>
          <div className="text-[10px] mt-[4px] opacity-60 tracking-[1px] font-medium">{desc}</div>
        </div>
      )}
      <input 
        type="file" 
        ref={fileInputRef} 
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/bmp" 
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
    <div className="bg-card rounded-2xl border border-border flex flex-col overflow-hidden h-[350px] lg:h-auto lg:min-h-[350px] group relative transition-all hover:border-accent shadow-sm">
      <div className="flex-1 bg-tag flex items-center justify-center relative">
        <span className="absolute top-[12px] left-[12px] bg-accent text-white px-[12px] py-[4px] rounded-full text-[10px] font-[700] tracking-[1px] z-10 uppercase shadow-sm">
          {badge}
        </span>
        {src && (
          <button 
            onClick={handleDownload}
            className="absolute top-[12px] right-[12px] z-10 bg-accent text-white p-2.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 hover:bg-accent-hover shadow-sm"
            title="下载图片"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
        {src ? (
          <img src={src} alt={title} className="w-full h-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-3">
             {icon}
             {!active && <div className="text-text-muted opacity-40 text-[12px] font-[600] uppercase tracking-[1px]">{desc}</div>}
          </div>
        )}
      </div>
      <div className="p-[16px] text-[13px] text-center font-[700] border-t border-border bg-card text-text-main shrink-0 uppercase tracking-[1px]">
        {title}
      </div>
    </div>
  );
}
