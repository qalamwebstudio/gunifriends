'use client';

import { useState } from 'react';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (category: string, description: string) => void;
  partnerInfo?: {
    id: string;
    roomId: string;
  };
}

const REPORT_CATEGORIES = [
  { value: 'inappropriate-behavior', label: 'Inappropriate Behavior' },
  { value: 'harassment', label: 'Harassment or Bullying' },
  { value: 'spam', label: 'Spam or Unwanted Content' },
  { value: 'other', label: 'Other' },
];

export default function ReportModal({ isOpen, onClose, onSubmit, partnerInfo }: ReportModalProps) {
  const [selectedCategory, setSelectedCategory] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCategory) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit(selectedCategory, description);

      // Reset form
      setSelectedCategory('');
      setDescription('');
      onClose();
    } catch (error) {
      console.error('Error submitting report:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setSelectedCategory('');
      setDescription('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[#00020d] bg-opacity-80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-700">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-white">Report User</h2>
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="text-gray-400 hover:text-gray-200 disabled:opacity-50"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Warning */}
          {/* Warning */}
          <div className="bg-yellow-900/20 border border-yellow-900 rounded-lg p-4 mb-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-200">
                  Important Notice
                </h3>
                <div className="mt-2 text-sm text-yellow-300">
                  <p>
                    Submitting this report will immediately end your current video chat session.
                    Please only report genuine violations of our community guidelines.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {/* Category Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Report Category *
              </label>
              <div className="space-y-2">
                {REPORT_CATEGORIES.map((category) => (
                  <label key={category.value} className="flex items-center">
                    <input
                      type="radio"
                      name="category"
                      value={category.value}
                      checked={selectedCategory === category.value}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      disabled={isSubmitting}
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-600 bg-gray-700 disabled:opacity-50"
                    />
                    <span className="ml-2 text-sm text-gray-300">{category.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Description */}
            <div className="mb-6">
              <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-2">
                Additional Details (Optional)
              </label>
              <textarea
                id="description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isSubmitting}
                placeholder="Please provide any additional context about the incident..."
                className="w-full px-3 py-2 bg-gray-800 text-white border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500 disabled:opacity-50 disabled:bg-gray-700"
                maxLength={500}
              />
              <p className="mt-1 text-xs text-gray-500">
                {description.length}/500 characters
              </p>
            </div>

            {/* Session Info */}
            {partnerInfo && (
              <div className="mb-6 p-3 bg-gray-800 rounded-lg">
                <h4 className="text-sm font-medium text-gray-200 mb-1">Session Information</h4>
                <p className="text-xs text-gray-400">
                  Room ID: {partnerInfo.roomId.slice(0, 8)}...
                </p>
                <p className="text-xs text-gray-400">
                  Timestamp: {new Date().toLocaleString()}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="flex-1 bg-gray-700 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!selectedCategory || isSubmitting}
                className="flex-1 bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Submitting...
                  </>
                ) : (
                  'Submit Report'
                )}
              </button>
            </div>
          </form>

          {/* Guidelines */}
          <div className="mt-6 pt-4 border-t border-gray-700">
            <h4 className="text-sm font-medium text-gray-300 mb-2">Community Guidelines</h4>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>• Be respectful and courteous to all users</li>
              <li>• No harassment, bullying, or inappropriate behavior</li>
              <li>• No spam, advertising, or unwanted content</li>
              <li>• Maintain appropriate conduct during video chats</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}