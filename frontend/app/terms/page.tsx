
export default function TermsPage() {
    return (
        <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8 space-y-8">
            <div>
                <h1 className="text-3xl font-black tracking-tight text-foreground uppercase mb-2">Terms of Service</h1>
                <p className="text-sm text-muted-foreground uppercase font-bold tracking-wider">
                    Last Updated: {new Date().toLocaleDateString()}
                </p>
            </div>

            <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-foreground/80">
                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">1. Acceptance of Terms</h2>
                    <p>
                        By accessing or using the Coinpree website and services ("Service"), you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part of the terms, you may not access the Service.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">2. Description of Service</h2>
                    <p>
                        Coinpree provides a cryptocurrency market analysis terminal, offering real-time data, algorithmic signals, and charting tools for informational purposes. We reserve the right to modify, suspend, or discontinue the Service at any time without notice.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">3. User Conduct</h2>
                    <p>
                        You agree not to satisfy any of the following:
                    </p>
                    <ul className="list-disc pl-5 space-y-1 mt-2">
                        <li>Use the Service for any illegal purpose or in violation of any local, state, national, or international law.</li>
                        <li>Attempt to gain unauthorized access to any portion of the Service or any other systems or networks connected to the Service.</li>
                        <li>Interfere with or disrupt the operation of the Service or servers or networks connected to the Service.</li>
                        <li>Use any robot, spider, site search/retrieval application, or other automated device to retrieve or index any portion of the Service without our express written consent.</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">4. Intellectual Property</h2>
                    <p>
                        The Service and its original content, features, and functionality are and will remain the exclusive property of Coinpree and its licensors. The Service is protected by copyright, trademark, and other laws. Our trademarks and trade dress may not be used in connection with any product or service without the prior written consent of Coinpree.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">5. Third-Party Links</h2>
                    <p>
                        Our Service may contain links to third-party web sites or services that are not owned or controlled by Coinpree. Coinpree has no control over, and assumes no responsibility for, the content, privacy policies, or practices of any third-party web sites or services. You further acknowledge and agree that Coinpree shall not be responsible or liable, directly or indirectly, for any damage or loss caused or alleged to be caused by or in connection with use of or reliance on any such content, goods or services available on or through any such web sites or services.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">6. Termination</h2>
                    <p>
                        We may terminate or suspend access to our Service immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">7. Changes to Terms</h2>
                    <p>
                        We reserve the right, at our sole discretion, to modify or replace these Terms at any time. By continuing to access or use our Service after those revisions become effective, you agree to be bound by the revised terms.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">8. Contact Us</h2>
                    <p>
                        If you have any questions about these Terms, please contact us via our official channels.
                    </p>
                </section>
            </div>
        </div>
    );
}
