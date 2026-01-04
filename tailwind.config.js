/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        'inter': ['var(--font-inter)', 'sans-serif'],
        'montserrat': ['var(--font-montserrat)', 'sans-serif'],
        'open-sans': ['var(--font-open-sans)', 'sans-serif'],
        'raleway': ['var(--font-raleway)', 'sans-serif'],
      },
      fontWeight: {
        'heading': '700',
        'heading-bold': '800',
        'body': '400',
        'body-medium': '500',
      },
    },
  },
  plugins: [],
}