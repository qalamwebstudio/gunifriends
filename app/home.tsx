'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Image from 'next/image';
// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export default function Home() {
  const [activeSection, setActiveSection] = useState('home');
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Animation refs
  const navRef = useRef(null);
  const heroContentRef = useRef(null);
  const heroOverlayRef = useRef(null);
  const heroButtonsRef = useRef(null);
  const badgesRef = useRef(null);
  const howItWorksRef = useRef(null);
  const connectingLineRef = useRef(null);
  const featuresRef = useRef(null);
  const aboutRef = useRef(null);
  const contactRef = useRef(null);
  const finalCtaRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => {
      // Change navbar when user scrolls past the hero section (full viewport height)
      setIsScrolled(window.scrollY > window.innerHeight - 100);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    // Initial animations on page load
    const tl = gsap.timeline();

    // Navbar animation from top
    tl.fromTo(navRef.current,
      { y: -100, opacity: 0 },
      { y: 0, opacity: 1, duration: 1, ease: "power3.out" }
    )

      // Hero overlay animation from left
      .fromTo(heroOverlayRef.current,
        { x: '-100%', opacity: 0 },
        { x: 0, opacity: 1, duration: 1.2, ease: "power3.out" }, "-=0.5"
      )

      // Hero content animation from left
      .fromTo(heroContentRef.current,
        { x: -100, opacity: 0 },
        { x: 0, opacity: 1, duration: 1, ease: "power3.out" }, "-=0.8"
      )

      // Hero buttons animation
      .fromTo(heroButtonsRef.current,
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" }, "-=0.3"
      )

      // Safety badges animation
      .fromTo(badgesRef.current,
        { y: 30, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, "-=0.2"
      );

    // Scroll-triggered animations

    // How It Works - Cards appear one by one
    gsap.fromTo(".step-card",
      { y: 100, opacity: 0, scale: 0.8 },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.8,
        ease: "power3.out",
        stagger: 0.3,
        scrollTrigger: {
          trigger: howItWorksRef.current,
          start: "top 80%",
          end: "bottom 20%",
          toggleActions: "play none none reverse"
        }
      }
    );

    // Connecting Line Animation - Responsive (appears after all cards are visible)
    gsap.fromTo(connectingLineRef.current,
      {
        scaleX: 0, // For desktop (horizontal line)
        scaleY: 0, // For mobile (vertical line)
        transformOrigin: "left center" // Desktop: grow from left
      },
      {
        scaleX: 1,
        scaleY: 1,
        duration: 1.5,
        ease: "power2.out",
        delay: 1.5, // Delay to let all cards appear first (0.8s + 0.6s stagger + 0.1s buffer)
        scrollTrigger: {
          trigger: howItWorksRef.current,
          start: "top 80%", // Same trigger as cards
          toggleActions: "play none none reverse"
        },
        onStart: function () {
          // Set different transform origins for mobile vs desktop
          const isMobile = window.innerWidth < 768;
          if (isMobile) {
            gsap.set(connectingLineRef.current, { transformOrigin: "center top" }); // Mobile: grow from top
          } else {
            gsap.set(connectingLineRef.current, { transformOrigin: "left center" }); // Desktop: grow from left
          }
        }
      }
    );

    // Features - First row then second row
    gsap.fromTo(".feature-card-row-1",
      { y: 80, opacity: 0, rotateX: 45 },
      {
        y: 0,
        opacity: 1,
        rotateX: 0,
        duration: 1,
        ease: "power3.out",
        stagger: 0.2,
        scrollTrigger: {
          trigger: featuresRef.current,
          start: "top 70%",
          toggleActions: "play none none reverse"
        }
      }
    );

    gsap.fromTo(".feature-card-row-2",
      { y: 80, opacity: 0, rotateX: 45 },
      {
        y: 0,
        opacity: 1,
        rotateX: 0,
        duration: 1,
        ease: "power3.out",
        stagger: 0.2,
        scrollTrigger: {
          trigger: featuresRef.current,
          start: "top 50%",
          toggleActions: "play none none reverse"
        }
      }
    );

    // About section - Text from bottom, cards blur effect from right
    gsap.fromTo(".about-text",
      { y: 100, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: aboutRef.current,
          start: "top 70%",
          toggleActions: "play none none reverse"
        }
      }
    );

    gsap.fromTo(".about-card",
      { x: 100, opacity: 0, filter: "blur(10px)" },
      {
        x: 0,
        opacity: 1,
        filter: "blur(0px)",
        duration: 1,
        ease: "power3.out",
        stagger: 0.2,
        scrollTrigger: {
          trigger: aboutRef.current,
          start: "top 60%",
          toggleActions: "play none none reverse"
        }
      }
    );

    // Contact section - Form and overlay from right
    gsap.fromTo(".contact-overlay",
      { x: '100%', opacity: 0 },
      {
        x: 0,
        opacity: 1,
        duration: 1.2,
        ease: "power3.out",
        scrollTrigger: {
          trigger: contactRef.current,
          start: "top 70%",
          toggleActions: "play none none reverse"
        }
      }
    );

    gsap.fromTo(".contact-form",
      { x: 80, opacity: 0 },
      {
        x: 0,
        opacity: 1,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: contactRef.current,
          start: "top 60%",
          toggleActions: "play none none reverse"
        }
      }
    );

    // Final CTA card
    gsap.fromTo(".final-cta-card",
      { y: 100, opacity: 0, scale: 0.9 },
      {
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 1,
        ease: "power3.out",
        scrollTrigger: {
          trigger: finalCtaRef.current,
          start: "top 80%",
          toggleActions: "play none none reverse"
        }
      }
    );

    return () => {
      ScrollTrigger.getAll().forEach(trigger => trigger.kill());
    };
  }, []);

  return (
    <div
      className="min-h-screen overflow-x-hidden relative"
      style={{
        backgroundImage: `url('/friends.jpeg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed'
      }}
    >
      {/* Top Navigation Bar */}
      <nav ref={navRef} className={`fixed top-0 left-0 right-0 z-[65] transition-all duration-300 ${isScrolled ? 'bg-white/95 backdrop-blur-sm shadow-lg' : ''}`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Logo Section - Left Side */}
            <div className="flex items-center space-x-3 z-10">
              <Image
                src={isScrolled ? "/logoherored.png" : "/logohero.png"}
                alt="Logo"
                className="h-12 md:h-16 w-auto transition-all duration-300"
              />
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden z-[70] relative w-8 h-8 flex flex-col justify-center items-center"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              <span className={`block w-6 h-0.5 bg-current transition-all duration-300 ${isMobileMenuOpen ? 'rotate-45 translate-y-1.5' : ''} ${isScrolled ? 'text-gray-700' : 'text-white'}`}></span>
              <span className={`block w-6 h-0.5 bg-current transition-all duration-300 my-1 ${isMobileMenuOpen ? 'opacity-0' : ''} ${isScrolled ? 'text-gray-700' : 'text-white'}`}></span>
              <span className={`block w-6 h-0.5 bg-current transition-all duration-300 ${isMobileMenuOpen ? '-rotate-45 -translate-y-1.5' : ''} ${isScrolled ? 'text-gray-700' : 'text-white'}`}></span>
            </button>

            {/* Desktop Navigation Section - Right Side */}
            <div className="hidden md:block relative">
              {/* Navigation background - changes based on scroll */}
              <div className={`relative transition-all duration-300 ${isScrolled
                ? 'bg-transparent' // When scrolled past hero, let the main nav background show through
                : 'bg-white/95 backdrop-blur-sm shadow-lg' // When in hero section, show white background with diagonal cut
                }`}
                style={!isScrolled ? {
                  clipPath: 'polygon(60px 0%, 100% 0%, 100% 100%, 0% 100%)',
                  paddingLeft: '80px',
                  paddingRight: '20px',
                  paddingTop: '12px',
                  paddingBottom: '12px'
                } : {
                  paddingLeft: '20px',
                  paddingRight: '20px',
                  paddingTop: '12px',
                  paddingBottom: '12px'
                }}>

                {/* Navigation Menu */}
                <div className="flex items-center space-x-8">
                  <a
                    href="#home"
                    className={`px-4 py-2 font-body-medium transition-all duration-300 ${activeSection === 'home' ? 'text-[#D53840] border-b-2 border-[#D53840]' : 'text-gray-700 hover:text-[#D53840]'}`}
                    onClick={() => setActiveSection('home')}
                  >
                    HOME
                  </a>
                  <a
                    href="#about"
                    className={`px-4 py-2 font-body-medium transition-all duration-300 ${activeSection === 'about' ? 'text-[#D53840] border-b-2 border-[#D53840]' : 'text-gray-700 hover:text-[#D53840]'}`}
                    onClick={() => setActiveSection('about')}
                  >
                    ABOUT
                  </a>
                  <a
                    href="#contact"
                    className={`px-4 py-2 font-body-medium transition-all duration-300 ${activeSection === 'contact' ? 'text-[#D53840] border-b-2 border-[#D53840]' : 'text-gray-700 hover:text-[#D53840]'}`}
                    onClick={() => setActiveSection('contact')}
                  >
                    CONTACT US
                  </a>
                  <Link
                    href="/login"
                    className="px-4 py-2 font-body-medium text-gray-700 hover:text-[#000934] transition-all duration-300"
                  >
                    LOGIN
                  </Link>

                  {/* Get Started Button */}
                  <Link
                    href="/register"
                    className="flex items-center space-x-2 bg-[#D53840] text-white px-4 py-2 rounded-lg ml-4 hover:bg-[#B8303A] transition-colors cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    <span className="text-sm font-body-medium">Get Started Free</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Menu Overlay */}
        <div
          className={`md:hidden  fixed inset-0 !bg-white z-[9999] transition-transform duration-300 ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}
          style={{ backgroundColor: 'white !important' }}
          onClick={(e) => {
            // Close menu if clicking on the overlay background
            if (e.target === e.currentTarget) {
              setIsMobileMenuOpen(false);
            }
          }}
        >
          {/* Close button */}
          <button
            className="absolute top-6 right-6 text-[#D53840] z-[10000]"
            onClick={() => setIsMobileMenuOpen(false)}
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className='bg-white h-[100vh]'>
            <div className="flex flex-col items-center justify-center h-full space-y-8 mt-15 bg-white">
              <a
                href="#home"
                className="text-[#D53840] text-2xl font-body-medium hover:text-[#B8303A] transition-colors"
                onClick={() => {
                  setActiveSection('home');
                  setIsMobileMenuOpen(false);
                }}
              >
                HOME
              </a>
              <a
                href="#about"
                className="text-[#D53840] text-2xl font-body-medium hover:text-[#B8303A] transition-colors"
                onClick={() => {
                  setActiveSection('about');
                  setIsMobileMenuOpen(false);
                }}
              >
                ABOUT
              </a>
              <a
                href="#contact"
                className="text-[#D53840] text-2xl font-body-medium hover:text-[#B8303A] transition-colors"
                onClick={() => {
                  setActiveSection('contact');
                  setIsMobileMenuOpen(false);
                }}
              >
                CONTACT US
              </a>
              <Link
                href="/login"
                className="text-[#D53840] text-2xl font-body-medium hover:text-[#B8303A] transition-colors"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                LOGIN
              </Link>
              <Link
                href="/register"
                className="bg-[#D53840] text-white px-8 py-3 rounded-lg text-xl font-body-medium hover:bg-[#B8303A] transition-colors cursor-pointer"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Get Started Free
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main>
        {/* Hero Section */}
        <section id="home" className="relative h-screen overflow-hidden">
          {/* Background Image */}
          <div className="absolute inset-0">
            <div
              className="w-full h-full bg-cover bg-center bg-no-repeat"
              style={{
                backgroundImage: `url('/heroback.png')`
              }}
            >
              {/* Overlay for better text readability */}
              <div className="absolute inset-0 bg-black/20"></div>
            </div>
          </div>

          {/* Diagonal Red Overlay - Responsive */}
          <div className="absolute inset-0">
            <div ref={heroOverlayRef} className="absolute inset-0 bg-[#D53840]/75 transform -skew-x-12 origin-top-left md:w-3/5 w-full h-full"></div>
          </div>

          {/* Hero Content - Mobile Responsive */}
          <div className="relative z-10 h-full flex items-center">
            <div ref={heroContentRef} className="max-w-2xl mx-4 md:ml-16 text-white">
              <h1 className="text-3xl md:text-6xl font-heading-bold leading-tight mb-4 md:mb-6">
                Meet Real Students.
                <span className="block">Face to Face.</span>
              </h1>

              <p className="text-base md:text-xl mb-3 md:mb-4 opacity-90 leading-relaxed font-body-medium">
                A secure video chat platform where only verified university students connect —live, face to face, and without fake profiles.
              </p>

              <p className="text-sm md:text-lg mb-6 md:mb-8 font-body-medium">
                Verified Students. Real Connections.
              </p>

              <div ref={heroButtonsRef} className="flex flex-row gap-3 md:gap-4 items-start flex-wrap">
                <Link
                  href="/register"
                  className="group px-6 md:px-8 py-3 md:py-4 bg-[#000934] text-white rounded-2xl hover:bg-[#000934]/90 transition-all duration-300 font-semibold text-base md:text-lg shadow-xl hover:shadow-2xl transform hover:-translate-y-1 flex items-center space-x-2 w-auto"
                >
                  <span>Start Video Chat</span>
                  <svg className="w-4 md:w-5 h-4 md:h-5 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>

                <Link
                  href="/login"
                  className="px-6 md:px-8 py-3 md:py-4 border-2 border-white text-white rounded-2xl hover:bg-white hover:text-[#D53840] transition-all duration-300 font-semibold text-base md:text-lg flex items-center w-auto"
                >
                  Login with University Email
                </Link>
              </div>

              {/* Safety Badges - Mobile Responsive */}
              <div ref={badgesRef} className="flex flex-col gap-2 md:gap-3 mt-6 md:mt-8 items-start">
                <div className="flex items-center space-x-2 bg-white px-3 md:px-4 py-2 rounded-full border border-white/30 backdrop-blur-sm w-auto">
                  <svg className="w-3 md:w-4 h-3 md:h-4 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-xs md:text-sm font-body text-[#000934]">University email verification required</span>
                </div>

                <div className="flex items-center space-x-2 bg-white px-3 md:px-4 py-2 rounded-full border border-white/30 backdrop-blur-sm w-auto">
                  <svg className="w-3 md:w-4 h-3 md:h-4 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-xs md:text-sm font-body text-[#000934]">Safe reporting & moderation</span>
                </div>
              </div>
            </div>
          </div>

        </section>

        {/* How It Works Section */}
        <section ref={howItWorksRef} className="py-12 md:py-16 bg-[#E6DDD4] relative">
          {/* Solid background overlay to hide global background */}
          <div className="absolute inset-0 bg-[#E6DDD4]"></div>
          <div className="relative z-10">
            <div className="max-w-6xl mx-auto px-4 md:px-8">
              <div className="text-center mb-8 md:mb-12">
                <h2 className="text-2xl md:text-4xl font-heading text-[#000934] mb-2 md:mb-4">How It Works</h2>
                <p className="text-base md:text-lg text-gray-700 font-body">Connect with verified students in three simple steps</p>
              </div>

              {/* Steps Container with Connecting Line */}
              <div className="relative">
                {/* Red Connecting Line - Horizontal on desktop, Vertical on mobile */}
                <div
                  ref={connectingLineRef}
                  className="absolute md:top-1/2 md:left-0 md:right-0 md:h-1 md:w-full top-0 left-1/2 w-1 h-full bg-[#D53840] md:transform md:-translate-y-1/2 transform -translate-x-1/2 md:translate-x-0 z-0"
                ></div>

                {/* Steps Grid - Vertical on mobile, Horizontal on desktop */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 relative z-10">

                  {/* Step 1 */}
                  <div className="step-card group relative">
                    <div className="bg-white/80 backdrop-blur-lg rounded-3xl p-6 md:p-8 shadow-xl border border-white/20 transition-all duration-300 transform hover:-translate-y-2 hover:shadow-2xl active:-translate-y-2 active:shadow-2xl relative overflow-hidden">
                      {/* Red Overlay on Hover/Touch */}
                      <div className="absolute inset-0 bg-[#D53840]/90 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-300 rounded-3xl flex flex-col items-center justify-center text-white">
                        <div className="w-12 md:w-16 h-12 md:h-16 bg-white/20 rounded-full flex items-center justify-center text-xl md:text-2xl font-bold mb-3 md:mb-4">
                          1
                        </div>
                        <h3 className="text-lg md:text-xl font-heading mb-2 md:mb-3">Register & Get Verified</h3>
                        <p className="text-center text-xs md:text-sm opacity-90 font-body px-2">Sign up with your university email address. Our system automatically verifies your student status.</p>
                      </div>

                      {/* Default Content */}
                      <div className="group-hover:opacity-0 group-active:opacity-0 transition-all duration-300">
                        <div className="w-full h-24 md:h-32 bg-gradient-to-br from-[#D53840]/20 to-[#000934]/20 rounded-2xl flex items-center justify-center mb-4 md:mb-6">
                          <svg className="w-12 md:w-16 h-12 md:h-16 text-[#000934]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <div className="w-10 md:w-12 h-10 md:h-12 bg-[#D53840] text-white rounded-full flex items-center justify-center text-lg md:text-xl font-bold mx-auto mb-2 md:mb-3">
                            1
                          </div>
                          <h4 className="text-base md:text-lg font-heading text-[#000934]">Register & Get Verified</h4>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="step-card group relative">
                    <div className="bg-white/80 backdrop-blur-lg rounded-3xl p-6 md:p-8 shadow-xl border border-white/20 transition-all duration-300 transform hover:-translate-y-2 hover:shadow-2xl active:-translate-y-2 active:shadow-2xl relative overflow-hidden">
                      {/* Red Overlay on Hover/Touch */}
                      <div className="absolute inset-0 bg-[#D53840]/90 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-300 rounded-3xl flex flex-col items-center justify-center text-white">
                        <div className="w-12 md:w-16 h-12 md:h-16 bg-white/20 rounded-full flex items-center justify-center text-xl md:text-2xl font-bold mb-3 md:mb-4">
                          2
                        </div>
                        <h3 className="text-lg md:text-xl font-heading mb-2 md:mb-3">Login Securely</h3>
                        <p className="text-center text-xs md:text-sm opacity-90 font-body px-2">Access your account with confidence. Our secure authentication system protects your privacy.</p>
                      </div>

                      {/* Default Content */}
                      <div className="group-hover:opacity-0 group-active:opacity-0 transition-all duration-300">
                        <div className="w-full h-24 md:h-32 bg-gradient-to-br from-[#000934]/20 to-[#D53840]/20 rounded-2xl flex items-center justify-center mb-4 md:mb-6">
                          <svg className="w-12 md:w-16 h-12 md:h-16 text-[#D53840]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <div className="w-10 md:w-12 h-10 md:h-12 bg-[#D53840] text-white rounded-full flex items-center justify-center text-lg md:text-xl font-bold mx-auto mb-2 md:mb-3">
                            2
                          </div>
                          <h4 className="text-base md:text-lg font-heading text-[#000934]">Login Securely</h4>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="step-card group relative">
                    <div className="bg-white/80 backdrop-blur-lg rounded-3xl p-6 md:p-8 shadow-xl border border-white/20 transition-all duration-300 transform hover:-translate-y-2 hover:shadow-2xl active:-translate-y-2 active:shadow-2xl relative overflow-hidden">
                      {/* Red Overlay on Hover/Touch */}
                      <div className="absolute inset-0 bg-[#D53840]/90 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-300 rounded-3xl flex flex-col items-center justify-center text-white">
                        <div className="w-12 md:w-16 h-12 md:h-16 bg-white/20 rounded-full flex items-center justify-center text-xl md:text-2xl font-bold mb-3 md:mb-4">
                          3
                        </div>
                        <h3 className="text-lg md:text-xl font-heading mb-2 md:mb-3">Start Video Chat</h3>
                        <p className="text-center text-xs md:text-sm opacity-90 font-body px-2">Connect with students from your campus or explore global connections with our smart matching system.</p>
                      </div>

                      {/* Default Content */}
                      <div className="group-hover:opacity-0 group-active:opacity-0 transition-all duration-300">
                        <div className="w-full h-24 md:h-32 bg-gradient-to-br from-[#D53840]/20 to-[#000934]/20 rounded-2xl flex items-center justify-center mb-4 md:mb-6">
                          <svg className="w-12 md:w-16 h-12 md:h-16 text-[#000934]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <div className="w-10 md:w-12 h-10 md:h-12 bg-[#D53840] text-white rounded-full flex items-center justify-center text-lg md:text-xl font-bold mx-auto mb-2 md:mb-3">
                            3
                          </div>
                          <h4 className="text-base md:text-lg font-heading text-[#000934]">Start Video Chat</h4>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </section>
        <section ref={featuresRef} className="py-12 md:py-20 relative">
          {/* Red overlay on the global background */}
          <div className="absolute inset-0 bg-[#D53840]/85"></div>
          <div className="relative z-10">
            <div className="max-w-6xl mx-auto px-4 md:px-8">
              <div className="text-center mb-12 md:mb-16">
                <h2 className="text-3xl md:text-5xl font-heading-bold text-white mb-4 md:mb-6">Our Features</h2>
                <p className="text-base md:text-xl text-white/90 max-w-2xl mx-auto font-body">
                  Everything you need for safe, meaningful student connections
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
                {/* Feature 1 */}
                <div className="feature-card-row-1 group bg-[#FDF6E3] backdrop-blur-lg rounded-3xl p-8 border border-white/20 transition-all duration-300 transform hover:-translate-y-2 active:-translate-y-2 relative overflow-hidden h-64 flex flex-col justify-between">
                  {/* Red Overlay on Hover/Touch */}
                  <div className="absolute inset-0 bg-[#D53840]/90 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-300 rounded-3xl flex flex-col items-center justify-center text-white p-8">
                    <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-3xl font-bold mb-6">
                      <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-heading-bold mb-4 text-center">Verified Students Only</h3>
                    <p className="text-center text-sm opacity-90 leading-relaxed font-body">Every user is verified through their university email address, ensuring authentic connections.</p>
                  </div>

                  {/* Default Content */}
                  <div className="group-hover:opacity-0 transition-all duration-300 flex flex-col justify-between h-full">
                    {/* Centered Icon */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="w-20 h-20 bg-[#000934] rounded-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                      </div>
                    </div>
                    {/* Bottom Heading */}
                    <div className="text-center">
                      <h3 className="text-xl font-heading text-[#000934]">Verified Students Only</h3>
                    </div>
                  </div>
                </div>

                {/* Feature 2 */}
                <div className="feature-card-row-1 group bg-[#FDF6E3] backdrop-blur-lg rounded-3xl p-8 border border-white/20 transition-all duration-300 transform hover:-translate-y-2 relative overflow-hidden h-64 flex flex-col justify-between">
                  {/* Red Overlay on Hover */}
                  <div className="absolute inset-0 bg-[#D53840]/90 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-300 rounded-3xl flex flex-col items-center justify-center text-white p-8">
                    <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-3xl font-bold mb-6">
                      <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-heading-bold mb-4 text-center">Random Video Chat</h3>
                    <p className="text-center text-sm opacity-90 leading-relaxed font-body">Connect instantly with students through high-quality video calls and real-time conversations.</p>
                  </div>

                  {/* Default Content */}
                  <div className="group-hover:opacity-0 transition-all duration-300 flex flex-col justify-between h-full">
                    {/* Centered Icon */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="w-20 h-20 bg-[#000934] rounded-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    </div>
                    {/* Bottom Heading */}
                    <div className="text-center">
                      <h3 className="text-xl font-heading text-[#000934]">Random Video Chat</h3>
                    </div>
                  </div>
                </div>

                {/* Feature 3 */}
                <div className="feature-card-row-1 group bg-[#FDF6E3] backdrop-blur-lg rounded-3xl p-8 border border-white/20 transition-all duration-300 transform hover:-translate-y-2 relative overflow-hidden h-64 flex flex-col justify-between">
                  {/* Red Overlay on Hover */}
                  <div className="absolute inset-0 bg-[#D53840]/90 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-300 rounded-3xl flex flex-col items-center justify-center text-white p-8">
                    <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-3xl font-bold mb-6">
                      <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-heading-bold mb-4 text-center">Report & Block</h3>
                    <p className="text-center text-sm opacity-90 leading-relaxed font-body">Advanced safety features to report inappropriate behavior and maintain a respectful environment.</p>
                  </div>

                  {/* Default Content */}
                  <div className="group-hover:opacity-0 transition-all duration-300 flex flex-col justify-between h-full">
                    {/* Centered Icon */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="w-20 h-20 bg-[#000934] rounded-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      </div>
                    </div>
                    {/* Bottom Heading */}
                    <div className="text-center">
                      <h3 className="text-xl font-heading text-[#000934]">Report & Block</h3>
                    </div>
                  </div>
                </div>

                {/* Feature 4 */}
                <div className="feature-card-row-2 group bg-[#FDF6E3] backdrop-blur-lg rounded-3xl p-8 border border-white/20 transition-all duration-300 transform hover:-translate-y-2 relative overflow-hidden h-64 flex flex-col justify-between">
                  {/* Red Overlay on Hover */}
                  <div className="absolute inset-0 bg-[#D53840]/90 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-300 rounded-3xl flex flex-col items-center justify-center text-white p-8">
                    <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-3xl font-bold mb-6">
                      <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-heading-bold mb-4 text-center">Campus & Global Match</h3>
                    <p className="text-center text-sm opacity-90 leading-relaxed font-body">Choose to connect with students from your campus or explore connections worldwide.</p>
                  </div>

                  {/* Default Content */}
                  <div className="group-hover:opacity-0 transition-all duration-300 flex flex-col justify-between h-full">
                    {/* Centered Icon */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="w-20 h-20 bg-[#000934] rounded-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9" />
                        </svg>
                      </div>
                    </div>
                    {/* Bottom Heading */}
                    <div className="text-center">
                      <h3 className="text-xl font-heading text-[#000934]">Campus & Global Match</h3>
                    </div>
                  </div>
                </div>

                {/* Feature 5 */}
                <div className="feature-card-row-2 group bg-[#FDF6E3] backdrop-blur-lg rounded-3xl p-8 border border-white/20 transition-all duration-300 transform hover:-translate-y-2 relative overflow-hidden h-64 flex flex-col justify-between">

                  {/* Red Overlay on Hover */}
                  <div className="absolute inset-0 bg-[#D53840]/90 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-300 rounded-3xl flex flex-col items-center justify-center text-white p-8">
                    <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-3xl font-bold mb-6">
                      <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 11c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm0 0c-3.314 0-6 2.686-6 6v1h12v-1c0-3.314-2.686-6-6-6z"
                        />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-heading-bold mb-4 text-center">Safe Environment</h3>
                    <p className="text-center text-sm opacity-90 leading-relaxed font-body">
                      A student-only platform designed to keep conversations respectful, secure, and comfortable for everyone.
                    </p>
                  </div>

                  {/* Default Content */}
                  <div className="group-hover:opacity-0 transition-all duration-300 flex flex-col justify-between h-full">

                    {/* Centered Icon */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="w-20 h-20 bg-[#000934] rounded-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 11c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm0 0c-3.314 0-6 2.686-6 6v1h12v-1c0-3.314-2.686-6-6-6z"
                          />
                        </svg>
                      </div>
                    </div>

                    {/* Bottom Heading */}
                    <div className="text-center">
                      <h3 className="text-xl font-heading text-[#000934]">Safe Environment</h3>
                    </div>

                  </div>
                </div>

                {/* Feature 6 */}
                <div className="feature-card-row-2 group bg-[#FDF6E3] backdrop-blur-lg rounded-3xl p-8 border border-white/20 transition-all duration-300 transform hover:-translate-y-2 relative overflow-hidden h-64 flex flex-col justify-between">
                  {/* Red Overlay on Hover */}
                  <div className="absolute inset-0 bg-[#D53840]/90 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-all duration-300 rounded-3xl flex flex-col items-center justify-center text-white p-8">
                    <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center text-3xl font-bold mb-6">
                      <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-heading-bold mb-4 text-center">Real Connections</h3>
                    <p className="text-center text-sm opacity-90 leading-relaxed font-body">Build meaningful relationships with fellow students who share your academic journey.</p>
                  </div>

                  {/* Default Content */}
                  <div className="group-hover:opacity-0 transition-all duration-300 flex flex-col justify-between h-full">
                    {/* Centered Icon */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="w-20 h-20 bg-[#000934] rounded-full flex items-center justify-center">
                        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                      </div>
                    </div>
                    {/* Bottom Heading */}
                    <div className="text-center">
                      <h3 className="text-xl font-heading text-[#000934]">Real Connections</h3>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section ref={aboutRef} id="about" className="py-12 md:py-20 bg-[#E6DDD4] relative">
          {/* Solid background overlay to hide global background */}
          <div className="absolute inset-0 bg-[#E6DDD4]"></div>
          <div className="relative z-10">
            <div className="max-w-6xl mx-auto px-4 md:px-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-16 items-center">
                <div className="about-text">
                  <div className="flex flex-col md:flex-row items-center md:items-center gap-4 mb-6 md:mb-8">
                    <h2 className="text-3xl md:text-5xl font-heading-bold text-[#000934]">About</h2>
                    <Image
                      src="/logoherored.png"
                      alt="CampusCam Logo"
                      className="h-12 md:h-20 w-auto"
                    />
                  </div>

                  <div className="space-y-4 md:space-y-6 text-base md:text-lg text-gray-700 leading-relaxed font-body">
                    <p>
                      <span className="font-body-medium text-[#D53840]">Built only for students.</span> CampusCam is the exclusive video chat platform designed specifically for university and college students worldwide.
                    </p>

                    <p>
                      <span className="font-body-medium text-[#D53840]">No bots, no fake profiles.</span> Every user is verified through their university email address, ensuring authentic connections with real students.
                    </p>

                    <p>
                      <span className="font-body-medium text-[#D53840]">Real conversations.</span> Connect with students from your own university or explore diverse perspectives from campuses around the globe.
                    </p>

                    <p>
                      <span className="font-body-medium text-[#D53840]">Safer than open random chat apps.</span> Our student-only environment creates a trusted space for meaningful academic and social connections.
                    </p>
                  </div>

                  <div className="mt-6 md:mt-8 flex flex-wrap gap-3 md:gap-4">
                    <div className="flex items-center space-x-2 bg-white/60 backdrop-blur-sm px-3 md:px-4 py-2 md:py-3 rounded-2xl border border-white/20">
                      <div className="w-3 md:w-4 h-3 md:h-4 bg-green-500 rounded-full"></div>
                      <span className="font-body-medium text-[#000934] text-sm md:text-base">University Verified</span>
                    </div>
                    <div className="flex items-center space-x-2 bg-white/60 backdrop-blur-sm px-3 md:px-4 py-2 md:py-3 rounded-2xl border border-white/20">
                      <div className="w-3 md:w-4 h-3 md:h-4 bg-[#D53840] rounded-full"></div>
                      <span className="font-body-medium text-[#000934] text-sm md:text-base">Student-Only</span>
                    </div>
                    <div className="flex items-center space-x-2 bg-white/60 backdrop-blur-sm px-3 md:px-4 py-2 md:py-3 rounded-2xl border border-white/20">
                      <div className="w-3 md:w-4 h-3 md:h-4 bg-blue-500 rounded-full"></div>
                      <span className="font-body-medium text-[#000934] text-sm md:text-base">Safe & Secure</span>
                    </div>
                  </div>
                </div>

                <div className="relative mt-8 lg:mt-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div className="space-y-4 md:space-y-6">
                      <div className="about-card bg-white/80 backdrop-blur-lg rounded-3xl p-6 shadow-xl border border-white/20 transform rotate-3 hover:rotate-0 transition-transform duration-500">
                        <div className="w-full h-40 bg-gradient-to-br from-[#D53840]/20 to-[#000934]/20 rounded-2xl flex items-center justify-center mb-4">
                          <svg className="w-16 h-16 text-[#000934]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                        <p className="text-center text-[#000934] font-semibold">Study Groups</p>
                      </div>

                      <div className="about-card bg-white/80 backdrop-blur-lg rounded-3xl p-6 shadow-xl border border-white/20 transform -rotate-2 hover:rotate-0 transition-transform duration-500">
                        <div className="w-full h-40 bg-gradient-to-br from-[#000934]/20 to-[#D53840]/20 rounded-2xl flex items-center justify-center mb-4">
                          <svg className="w-16 h-16 text-[#D53840]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                        </div>
                        <p className="text-center text-[#000934] font-semibold">Campus Life</p>
                      </div>
                    </div>

                    <div className="space-y-6 mt-12">
                      <div className="about-card bg-white/80 backdrop-blur-lg rounded-3xl p-6 shadow-xl border border-white/20 transform rotate-2 hover:rotate-0 transition-transform duration-500">
                        <div className="w-full h-40 bg-gradient-to-br from-[#D53840]/20 to-[#000934]/20 rounded-2xl flex items-center justify-center mb-4">
                          <svg className="w-16 h-16 text-[#000934]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9" />
                          </svg>
                        </div>
                        <p className="text-center text-[#000934] font-semibold">Global Network</p>
                      </div>

                      <div className="about-card bg-white/80 backdrop-blur-lg rounded-3xl p-6 shadow-xl border border-white/20 transform -rotate-1 hover:rotate-0 transition-transform duration-500">
                        <div className="w-full h-40 bg-gradient-to-br from-[#000934]/20 to-[#D53840]/20 rounded-2xl flex items-center justify-center mb-4">
                          <svg className="w-16 h-16 text-[#D53840]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                        </div>
                        <p className="text-center text-[#000934] font-semibold">Verified Safe</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section ref={contactRef} id="contact" className="relative py-16 overflow-hidden">
          {/* Background Image */}
          <div className="absolute inset-0">
            <div
              className="w-full h-full bg-cover bg-center bg-no-repeat"
              style={{
                backgroundImage: `url('/footcopy.jpg')`
              }}
            >
              {/* Overlay for better text readability */}
              <div className="absolute inset-0 bg-black/20"></div>
            </div>
          </div>

          {/* Diagonal Red Overlay - Made Wider */}
          <div className="absolute inset-0">
            <div className="contact-overlay absolute inset-0 bg-[#D53840]/85 transform skew-x-12 origin-top-right w-3/5 h-full ml-auto"></div>
          </div>

          <div className="relative z-10 max-w-7xl mx-auto px-8 h-full flex items-center">
            <div className="w-full flex justify-end min-h-[500px]">
              {/* Contact Form - Positioned with margin from right */}
              <div className="contact-form w-full max-w-lg mr-8">
                <div className="text-center mb-8">
                  <h2 className="text-4xl font-heading text-white mb-4">Contact Us</h2>
                  <p className="text-lg text-white/90 font-body">
                    Have questions? We're here to help you connect with fellow students safely.
                  </p>
                </div>

                <form className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-white font-body-medium mb-2">Name</label>
                      <input
                        type="text"
                        className="w-full px-4 py-3 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl text-white placeholder-white/70 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                        placeholder="Your name"
                      />
                    </div>
                    <div>
                      <label className="block text-white font-body-medium mb-2">Email</label>
                      <input
                        type="email"
                        className="w-full px-4 py-3 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl text-white placeholder-white/70 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                        placeholder="your@university.edu"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-white font-body-medium mb-2">Subject</label>
                    <input
                      type="text"
                      className="w-full px-4 py-3 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl text-white placeholder-white/70 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent"
                      placeholder="How can we help?"
                    />
                  </div>

                  <div>
                    <label className="block text-white font-body-medium mb-2">Message</label>
                    <textarea
                      rows={4}
                      className="w-full px-4 py-3 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl text-white placeholder-white/70 focus:outline-none focus:ring-2 focus:ring-white focus:border-transparent resize-none"
                      placeholder="Tell us about your question or feedback..."
                    ></textarea>
                  </div>

                  <button
                    type="submit"
                    className="w-full px-8 py-4 bg-white/20 backdrop-blur-sm border border-white/30 text-white rounded-2xl hover:bg-white/30 transition-all duration-300 font-semibold text-lg shadow-xl hover:shadow-2xl transform hover:-translate-y-1"
                  >
                    Send Message
                  </button>
                </form>

                {/* Contact Info */}
                <div className="mt-8 grid grid-cols-3 gap-4 text-center">
                  <div className="text-white">
                    <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-2">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-xs font-semibold">Email Support</p>
                    <p className="text-xs text-white/80">support@campuscam.com</p>
                  </div>

                  <div className="text-white">
                    <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-2">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <p className="text-xs font-semibold">Response Time</p>
                    <p className="text-xs text-white/80">Within 24 hours</p>
                  </div>

                  <div className="text-white">
                    <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center mx-auto mb-2">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 515.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <p className="text-xs font-semibold">Student Support</p>
                    <p className="text-xs text-white/80">Dedicated to students</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section ref={finalCtaRef} className="py-12 md:py-20 bg-[#E6DDD4] relative">
          {/* Solid background overlay to hide global background */}
          <div className="absolute inset-0 bg-[#E6DDD4]"></div>
          <div className="relative z-10">
            <div className="max-w-4xl mx-auto text-center px-4 md:px-8">
              <div className="final-cta-card bg-white/80 backdrop-blur-lg rounded-3xl p-5 md:p-12 border border-white/20 shadow-[0_20px_50px_rgba(213,56,64,0.3)]">
                <h2 className="text-2xl md:text-4xl font-heading text-[#000934] mb-4 md:mb-6">
                  Ready to Connect with Real Students?
                </h2>
                <p className="text-base md:text-xl text-gray-700 mb-6 md:mb-8 max-w-2xl mx-auto font-body">
                  Join thousands of verified students already making meaningful connections on CampusCam.
                </p>

                <div className="flex flex-col gap-3 md:gap-4 justify-center">
                  <Link
                    href="/register"
                    className="group px-6 md:px-8 py-3 md:py-4 bg-[#000934] text-white rounded-2xl hover:bg-[#000934]/90 transition-all duration-300 font-semibold text-base md:text-lg shadow-xl hover:shadow-2xl transform hover:-translate-y-1 flex items-center justify-center space-x-2"
                  >
                    <span>Get Started Now</span>
                    <svg className="w-4 md:w-5 h-4 md:h-5 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </Link>

                  <Link
                    href="/login"
                    className="px-6 md:px-8 py-3 md:py-4 border-2 border-[#D53840] text-[#D53840] rounded-2xl hover:bg-[#D53840] hover:text-white transition-all duration-300 font-semibold text-base md:text-lg flex items-center justify-center"
                  >
                    Already have an account?
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-6 bg-slate-800 relative">
          <div className="absolute inset-0 bg-slate-800"></div>
          <div className="relative z-10">
            <div className="max-w-6xl mx-auto px-8 text-center">
              <p className="text-white/80 font-body">
                Made with ❤️ by QalamWebStudio © 2026 CampusCam. All rights reserved.
              </p>
            </div>
          </div>
        </footer>
      </main>
    </div >
  );
}
