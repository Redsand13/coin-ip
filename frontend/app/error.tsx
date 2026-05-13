'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log the error to an error reporting service
        console.error('Page Error:', error);
    }, [error]);

    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-4">
            <div className="text-center space-y-4">
                <h2 className="text-2xl font-bold text-foreground">Something went wrong!</h2>
                <p className="text-muted-foreground max-w-md">
                    {error.message || 'An unexpected error occurred'}
                </p>
                {error.digest && (
                    <p className="text-xs text-muted-foreground">Error ID: {error.digest}</p>
                )}
                <Button
                    onClick={() => reset()}
                    className="mt-4"
                >
                    Try again
                </Button>
            </div>
        </div>
    );
}
