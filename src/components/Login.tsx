import React, { useState, useEffect } from 'react';
import { Lock, RefreshCw } from 'lucide-react';
import WebsiteLogo from '../assets/Website-Logo.png';
import { useNavigate, Link } from 'react-router-dom';

export default function Login({ setAuthToken, setUser }: { setAuthToken: (t: string) => void, setUser: (u: any) => void }) {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  const validateField = (name: string, value: string) => {
    let err = '';
    if (!value) {
      err = name === 'captchaAnswer' ? 'Captcha is required.' : 'This field is required.';
    } else if (name === 'identifier') {
      if (!/^[a-zA-Z0-9_]+$/.test(value)) {
        err = 'Only letters, numbers, and underscores are allowed.';
      }
    }
    setFieldErrors(prev => ({ ...prev, [name]: err }));
    return err;
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    validateField(name, value);
  };

  const loadCaptcha = async () => {
    try {
      console.log('Checking Django CAPTCHA service health...');
      const healthRes = await fetch('/api/captcha/health');
      if (!healthRes.ok) throw new Error('CAPTCHA service is unreachable.');

      console.log('Fetching new CAPTCHA...');
      const res = await fetch('/api/captcha/generate');
      
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error('Raw CAPTCHA API Response was not JSON:', text);
        throw new Error('CAPTCHA server unavailable. Received HTML instead of JSON.');
      }
      
      console.log('CAPTCHA API Response:', data);
      console.log('Stored CAPTCHA Key:', data.captcha_key);
      console.log('Stored Image URL:', data.captcha_image);
      
      setCaptchaId(data.captcha_key);
      setCaptchaImage(data.captcha_image);
      setCaptchaAnswer('');
    } catch (err: any) {
      console.error('Failed to load Django CAPTCHA', err);
      setError(err.message || 'CAPTCHA server is offline.');
    }
  };

  useEffect(() => {
    loadCaptcha();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    let hasError = false;
    const newErrors: Record<string, string> = {};
    const newTouched = { identifier: true, password: true, captchaAnswer: true };
    
    if (!identifier) { hasError = true; newErrors.identifier = 'This field is required.'; }
    if (!password) { hasError = true; newErrors.password = 'This field is required.'; }
    if (!captchaAnswer) { hasError = true; newErrors.captchaAnswer = 'Captcha is required.'; }
    
    setTouched(newTouched);
    setFieldErrors(newErrors);
    
    if (hasError) return;

    setLoading(true);

    try {
      console.log('Validating CAPTCHA with key:', captchaId, 'value:', captchaAnswer);
      
      // 1. Validate CAPTCHA with Django Service
      const captchaRes = await fetch('/api/captcha/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captcha_key: captchaId, captcha_value: captchaAnswer })
      });
      
      const captchaText = await captchaRes.text();
      let captchaData;
      try {
        captchaData = JSON.parse(captchaText);
      } catch (err) {
        console.error('Raw CAPTCHA Validation Response was not JSON:', captchaText);
        throw new Error('CAPTCHA validation server unavailable.');
      }
      
      console.log('Validation API Response:', captchaData);
      
      if (!captchaData.success) {
        throw new Error('Captcha is incorrect. Please try again.');
      }

      // 2. Proceed with Express Login
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error('Invalid username or password.');
      }

      setAuthToken(data.token);
      setUser(data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
      loadCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 w-full max-w-md">
        <div className="text-center mb-8 flex flex-col items-center">
          <img src={WebsiteLogo} alt="RDSO" className="w-[64px] h-[64px] object-contain shrink-0 mb-3" />
          <div className="flex flex-col items-center">
            <span className="font-extrabold text-[24px] tracking-tight text-gray-900 leading-tight">RDSO</span>
            <span className="text-[14px] font-semibold tracking-wide uppercase text-gray-500 leading-tight mt-1">Indian Railways</span>
          </div>
          <p className="text-gray-500 mt-6 font-medium">Sign in to your account</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-6 text-sm border border-red-100 flex items-start shadow-sm">
            <svg className="w-5 h-5 mr-3 shrink-0 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="font-medium">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Username</label>
            <input
              type="text"
              name="identifier"
              className={`w-full border ${fieldErrors.identifier ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20 bg-red-50/30' : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'} rounded-xl px-4 py-3 transition-all outline-none focus:ring-4 shadow-sm text-gray-900 placeholder-gray-400`}
              value={identifier}
              onChange={e => { setIdentifier(e.target.value); validateField('identifier', e.target.value); }}
              onBlur={handleBlur}
              placeholder="Enter your username"
            />
            {fieldErrors.identifier && <p className="text-red-500 text-xs mt-1.5 font-medium flex items-center"><svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{fieldErrors.identifier}</p>}
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="block text-sm font-semibold text-gray-700">Password</label>
              <Link to="/forgot-password" className="text-sm text-blue-600 hover:text-blue-700 hover:underline font-semibold transition-colors">Forgot Password?</Link>
            </div>
            <input
              type="password"
              name="password"
              className={`w-full border ${fieldErrors.password ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20 bg-red-50/30' : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'} rounded-xl px-4 py-3 transition-all outline-none focus:ring-4 shadow-sm text-gray-900 placeholder-gray-400`}
              value={password}
              onChange={e => { setPassword(e.target.value); if (touched.password) validateField('password', e.target.value); }}
              onBlur={handleBlur}
              placeholder="••••••••"
            />
            {fieldErrors.password && <p className="text-red-500 text-xs mt-1.5 font-medium flex items-center"><svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{fieldErrors.password}</p>}
          </div>

          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <label className="block text-sm font-semibold text-gray-800 mb-3">Security Verification</label>
            <div className="flex items-center justify-between mb-3 bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
              <div className="flex-1 flex justify-center">
                {captchaImage ? (
                  <img src={captchaImage} alt="Captcha" className="h-12 w-auto object-contain rounded select-none" draggable="false" />
                ) : (
                  <div className="h-12 w-32 bg-gray-100 animate-pulse rounded" />
                )}
              </div>
              <div className="border-l border-gray-100 pl-3 ml-2 flex items-center justify-center">
                <button type="button" onClick={loadCaptcha} className="p-2.5 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 rounded-lg transition-colors flex items-center justify-center group" title="Refresh captcha">
                  <RefreshCw className="w-5 h-5 group-hover:rotate-180 transition-transform duration-300" />
                </button>
              </div>
            </div>
            <input
              type="text"
              name="captchaAnswer"
              placeholder="ENTER THE CODE ABOVE"
              className={`w-full border ${fieldErrors.captchaAnswer ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20 bg-red-50/30' : 'border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'} rounded-xl p-3 text-center text-lg outline-none focus:ring-4 font-mono tracking-widest uppercase transition-all bg-white shadow-sm placeholder-gray-400`}
              value={captchaAnswer}
              onChange={e => { setCaptchaAnswer(e.target.value); if (touched.captchaAnswer) validateField('captchaAnswer', e.target.value); }}
              onBlur={handleBlur}
              autoComplete="off"
            />
            {fieldErrors.captchaAnswer && <p className="text-red-500 text-xs mt-2 text-center font-medium flex items-center justify-center"><svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{fieldErrors.captchaAnswer}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-xl py-3 px-4 hover:bg-blue-700 transition-all flex justify-center items-center font-semibold shadow-sm hover:shadow active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed focus:outline-none focus:ring-4 focus:ring-blue-500/30"
          >
            {loading ? (
              <><svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Signing in...</>
            ) : (
              <><Lock className="w-4 h-4 mr-2" /> Sign In</>
            )}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-gray-600">
          Don't have an account? <Link to="/register" className="text-blue-600 hover:text-blue-700 hover:underline font-semibold ml-1 transition-colors">Create Account</Link>
        </div>
      </div>
    </div>
  );
}
