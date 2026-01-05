'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { gsap } from 'gsap';
import { UniversityEmailValidator } from '../utils/validation';
import { UNIVERSITY_DOMAINS } from '../types';

interface FormData {
  email: string;
  password: string;
  confirmPassword: string;
  university: string;
}

interface FormErrors {
  email?: string;
  password?: string;
  confirmPassword?: string;
  university?: string;
  general?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
    confirmPassword: '',
    university: ''
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

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
    gsap.set(leftSectionRef.current?.children, {
      opacity: 0,
      y: 30
    });
    gsap.set(overlayRef.current, {
      opacity: 0
    });
    gsap.set(rightContentRef.current?.children, {
      opacity: 0,
      y: 20
    });

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
      
      // 2. Register card appears
      .to(cardRef.current, {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.8,
        ease: "power2.out"
      }, "-=0.4")
      
      // 3. Left section content animates in
      .to(leftSectionRef.current?.children, {
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
      .to(rightContentRef.current?.children, {
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
    const emailValidation = UniversityEmailValidator.validateUniversityEmail(formData.email);
    if (!emailValidation.isValid) {
      newErrors.email = emailValidation.errors.join(', ');
    }

    // Password validation
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters long';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one uppercase letter, one lowercase letter, and one number';
    }

    // Confirm password validation
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    // University validation
    if (!formData.university) {
      newErrors.university = 'Please select your university';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    // Clear specific field error when user starts typing
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }

    // Auto-detect university from email domain
    if (name === 'email' && value) {
      const universityName = UniversityEmailValidator.getUniversityName(value);
      if (universityName) {
        setFormData(prev => ({ ...prev, university: universityName }));
      }
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
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          university: formData.university
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSuccessMessage('Registration successful! Please check your email to verify your account.');
        setFormData({ email: '', password: '', confirmPassword: '', university: '' });
      } else {
        setErrors({ general: data.error || 'Registration failed. Please try again.' });
      }
    } catch (error) {
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
          
          {/* Left Section - Register Form */}
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
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Your Account</h1>
              <p className="text-gray-600">Join the university community today</p>
            </div>

            {/* Success Message */}
            {successMessage && (
              <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg">
                {successMessage}
              </div>
            )}

            {/* Error Message */}
            {errors.general && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                {errors.general}
              </div>
            )}

            {/* Register Form */}
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  University Email Address
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
                  placeholder="your.email@gnu.ac.in"
                />
                {errors.email && (
                  <p className="mt-2 text-sm text-red-600">{errors.email}</p>
                )}
              </div>

              <div>
                <label htmlFor="university" className="block text-sm font-medium text-gray-700 mb-2">
                  University
                </label>
                <select
                  id="university"
                  name="university"
                  required
                  value={formData.university}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border ${
                    errors.university ? 'border-red-300' : 'border-gray-300'
                  } rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D53840] focus:border-transparent transition-all duration-200 hover:border-gray-400`}
                >
                  <option value="">Select your university</option>
                  {UNIVERSITY_DOMAINS.map((university) => (
                    <option key={university.name} value={university.name}>
                      {university.name}
                    </option>
                  ))}
                </select>
                {errors.university && (
                  <p className="mt-2 text-sm text-red-600">{errors.university}</p>
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
                  autoComplete="new-password"
                  required
                  value={formData.password}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border ${
                    errors.password ? 'border-red-300' : 'border-gray-300'
                  } rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D53840] focus:border-transparent transition-all duration-200 hover:border-gray-400`}
                  placeholder="Enter a strong password"
                />
                {errors.password && (
                  <p className="mt-2 text-sm text-red-600">{errors.password}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  Must be at least 8 characters with uppercase, lowercase, and number
                </p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm Password
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  className={`w-full px-4 py-3 border ${
                    errors.confirmPassword ? 'border-red-300' : 'border-gray-300'
                  } rounded-lg focus:outline-none focus:ring-2 focus:ring-[#D53840] focus:border-transparent transition-all duration-200 hover:border-gray-400`}
                  placeholder="Confirm your password"
                />
                {errors.confirmPassword && (
                  <p className="mt-2 text-sm text-red-600">{errors.confirmPassword}</p>
                )}
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
                {isLoading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>

            {/* Sign In Link */}
            <div className="mt-8 text-center">
              <p className="text-gray-600">
                Already have an account?{' '}
                <Link
                  href="/login"
                  className="font-medium text-[#D53840] hover:text-[#B8303A] transition-colors"
                >
                  Sign In
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
                src="/register.jpeg"
                alt="Register Background"
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
                  Start Your University Journey
                </h2>
                <p className="text-white/90 leading-relaxed">
                  Connect with fellow students, share experiences, and build lasting friendships in your university community.
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