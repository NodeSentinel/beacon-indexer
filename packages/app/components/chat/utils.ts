export const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  });
};

export const formatDate = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 1) return 'TODAY';
  if (diffDays <= 7) return date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }).toUpperCase();
};
