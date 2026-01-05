'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { gsap } from 'gsap';

interface FormData {
  email: string;
  password: string;
}

interface FormErrors {
  email?: string;
  password?: string;
  general?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: ''
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);

  // Refs for animation elements
  const topCircleRef = useRef<HTMLDivElement>(null);
  const bottomCircleRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const leftSectionRef = useRef<HTMLDivElement>(null);
  const rightSectionRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const rightContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tl = gsap.timeline();

    // Set initial states
    gsap.set([topCircleRef.current, bottomCircleRef.current], {
      scale: 0,
      transformOrigin: "center center"
    });
    gsap.set(cardRef.current, {
      opacity: 0,
      y: 50,
      scale: 0.9
    });
    if (leftSectionRef.current?.children) {
      gsap.set(leftSectionRef.current.children, {
        opacity: 0,
        y: 30
      });
    }
    gsap.set(overlayRef.current, {
      opacity: 0
    });
    if (rightContentRef.current?.children) {
      gsap.set(rightContentRef.current.children, {
        opacity: 0,
        y: 20
      });
    }

    // Animation sequence
    tl
      // 1. Circles animate from corners - faster and closer together
      .to(topCircleRef.current, {
        scale: 1,
        duration: 0.8,
        ease: "power3.out"
      })
      .to(bottomCircleRef.current, {
        scale: 1,
        duration: 0.8,
        ease: "power3.out"
      }, "-=0.6")
      
      // 2. Login card appears
      .to(cardRef.current, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.8,
        ease: "power2.out"
      }, "-=0.4")
      
      // 3. Left section content animates in
      .to(leftSectionRef.current?.children || [], {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: "power2.out"
      }, "-=0.2")
      
      // 4. Right section overlay appears
      .to(overlayRef.current, {
        opacity: 1,
        duration: 0.8,
        ease: "power2.out"
      }, "-=0.3")
      
      // 5. Right section content appears
      .to(rightContentRef.current?.children || [], {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: 0.15,
        ease: "power2.out"
      }, "-=0.4");

  }, []);

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Email validation
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    // Password validation
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear specific field error when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password
        }),
      });

      const data = await response.json();
      console.log('Login response:', { status: response.status, data }); // Debug log

      if (response.ok && data.success) {
        // Store the JWT token in localStorage
        if (data.data && data.data.token) {
          try {
            localStorage.setItem('authToken', data.data.token);
            console.log('Token stored successfully:', data.data.token.substring(0, 20) + '...'); // Debug log
            
            // Verify token was stored before redirecting
            const storedToken = localStorage.getItem('authToken');
            if (storedToken === data.data.token) {
              console.log('Token verified in localStorage, redirecting...'); // Debug log
              // Use replace instead of push to avoid back button issues
              window.location.replace('/');
            } else {
              console.error('Token storage verification failed'); // Debug log
              setErrors({ general: 'Failed to store authentication token. Please try again.' });
            }
          } catch (error) {
            console.error('localStorage error:', error); // Debug log
            setErrors({ general: 'Failed to store authentication token. Please check if cookies/localStorage are enabled.' });
          }
        } else {
          console.error('No token in response:', data); // Debug log
          setErrors({ general: 'Login successful but no authentication token received. Please try again.' });
        }
      } else {
        // Handle specific error cases
        if (response.status === 401) {
          setErrors({ general: 'Invalid email or password. Please try again.' });
        } else if (response.status === 403) {
          setErrors({ general: data.error || 'Please verify your email address before logging in.' });
        } else {
          setErrors({ general: data.error || 'Login failed. Please try again.' });
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      setErrors({ general: 'Network error. Please check your connection and try again.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative Background Circles - Large and intersecting with card like in reference */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Massive circle at top left - intersects with card */}
        <div 
          ref={topCircleRef}
          className="absolute -top-64 -left-64 w-[600px] h-[600px] bg-red-500 rounded-full"
        ></div>
        {/* Massive circle at bottom right - intersects with card */}
        <div 
          ref={bottomCircleRef}
          className="absolute -bottom-64 -right-64 w-[600px] h-[600px] bg-red-500 rounded-full"
        ></div>
      </div>

      {/* Main Card Container */}
      <div 
        ref={cardRef}
        className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden z-10"
      >
        <div className="flex flex-col lg:flex-row min-h-[600px]">
          
          {/* Left Section - Login Form */}
          <div 
            ref={leftSectionRef}
            className="flex-1 p-8 lg:p-12 flex flex-col justify-center"
          >
            {/* Logo and Welcome */}
            <div className="mb-8 text-center lg:text-left">
              <div className="mb-6">
                <Image
                  src="/logoherored.png"
                  alt="Logo"
                  width={120}
                  height={40}
                  className="mx-auto lg:mx-0"
                />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h1>
              <p className="text-gray-600">Login using your university email</p>
            </div>

            {/* Error Message */}
            {errors.general && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                {errors.general}
              </div>
            )}

            {/* Login Form */}
            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={formData.email}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border ${
                    errors.email ? 'border-red-300' : 'border-gray-300'
                  } rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D53840] focus:border-transparent transition-all duration-200 hover:border-gray-400`}
                  placeholder="your.email@university.edu"
                />
                {errors.email && (
                  <p className="mt-2 text-sm text-red-600">{errors.email}</p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={formData.password}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border ${
                    errors.password ? 'border-red-300' : 'border-gray-300'
                  } rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D53840] focus:border-transparent transition-all duration-200 hover:border-gray-400`}
                  placeholder="Enter your password"
                />
                {errors.password && (
                  <p className="mt-2 text-sm text-red-600">{errors.password}</p>
                )}
              </div>

              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="h-4 w-4 text-[#D53840] focus:ring-[#D53840] border-gray-300 rounded"
                  />
                  <label htmlFor="remember-me" className="ml-2 text-gray-700">
                    Remember me
                  </label>
                </div>
                <Link
                  href="/forgot-password"
                  className="font-medium text-[#D53840] hover:text-[#B8303A] transition-colors"
                >
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-3 px-4 rounded-lg text-white font-medium transition-all duration-200 ${
                  isLoading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-[#D53840] hover:bg-[#B8303A] hover:shadow-lg transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[#D53840] focus:ring-offset-2'
                }`}
              >
                {isLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            {/* Sign Up Link */}
            <div className="mt-8 text-center">
              <p className="text-gray-600">
                Don't have an account?{' '}
                <Link
                  href="/register"
                  className="font-medium text-[#D53840] hover:text-[#B8303A] transition-colors"
                >
                  Sign Up Now
                </Link>
              </p>
            </div>
          </div>

          {/* Right Section - Visual */}
          <div 
            ref={rightSectionRef}
            className="flex-1 relative bg-gradient-to-br from-[#D53840] to-[#B8303A] overflow-hidden"
          >
            {/* Background Image */}
            <div className="absolute inset-0">
              <Image
                src="/campus.jpeg"
                alt="Campus Background"
                fill
                className="object-cover"
                priority
              />
              {/* Red Gradient Overlay */}
              <div 
                ref={overlayRef}
                className="absolute inset-0 bg-[#D53840]/75"
              ></div>
            </div>

            {/* Content */}
            <div 
              ref={rightContentRef}
              className="relative z-10 h-full flex flex-col items-center justify-center text-center p-8 lg:p-12"
            >
              <div className="mb-8">
                <Image
                  src="/logohero.png"
                  alt="Logo"
                  width={150}
                  height={50}
                  className="mx-auto filter brightness-0 invert"
                />
              </div>
              
              <div className="text-white max-w-sm">
                <h2 className="text-2xl lg:text-3xl font-bold mb-4">
                  Connect with Your Campus Community
                </h2>
                <p className="text-white/90 leading-relaxed">
                  Join thousands of university students in meaningful conversations and build lasting connections.
                </p>
              </div>

              {/* Decorative Elements */}
              <div className="absolute top-10 right-10 w-20 h-20 border border-white/20 rounded-full"></div>
              <div className="absolute bottom-20 left-10 w-16 h-16 border border-white/20 rounded-full"></div>
              <div className="absolute top-1/3 left-8 w-2 h-2 bg-white/40 rounded-full"></div>
              <div className="absolute bottom-1/3 right-12 w-3 h-3 bg-white/30 rounded-full"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}