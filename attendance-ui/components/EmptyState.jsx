import React from 'react';
import { motion } from 'framer-motion';
import { FileQuestion } from 'lucide-react';

export default function EmptyState({ 
  icon: Icon = FileQuestion, 
  title = "No records found", 
  description = "There are no records to display at this time.", 
  action = null 
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-muted">
      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3 }}
        className="w-16 h-16 mb-4 rounded-full bg-white/5 flex items-center justify-center border border-glass-border"
      >
        <Icon className="w-8 h-8 opacity-40 text-foreground" />
      </motion.div>
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="text-center"
      >
        <p className="text-foreground font-semibold mb-1 text-lg">{title}</p>
        <p className="text-sm max-w-sm mx-auto text-muted mb-4">{description}</p>
        {action && (
          <div className="mt-4">
            {action}
          </div>
        )}
      </motion.div>
    </div>
  );
}
