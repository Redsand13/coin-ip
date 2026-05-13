
export default function PrivacyPage() {
    return (
        <div className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8 space-y-8">
            <div>
                <h1 className="text-3xl font-black tracking-tight text-foreground uppercase mb-2">Privacy Policy</h1>
                <p className="text-sm text-muted-foreground uppercase font-bold tracking-wider">
                    Effective Date: {new Date().toLocaleDateString()}
                </p>
            </div>

            <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-foreground/80">
                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">1. Introduction</h2>
                    <p>
                        Coinpree ("us", "we", or "our") operates the Coinpree website (the "Service"). This page informs you of our policies regarding the collection, use, and disclosure of personal data when you use our Service and the choices you have associated with that data.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">2. Information Collection and Use</h2>
                    <p>
                        We collect several different types of information for various purposes to provide and improve our Service to you.
                    </p>
                    <h3 className="text-md font-semibold text-foreground mt-4 mb-2">Types of Data Collected</h3>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>
                            <strong>Usage Data:</strong> We may collect information on how the Service is accessed and used ("Usage Data"). This Usage Data may include information such as your computer's Internet Protocol address (e.g. IP address), browser type, browser version, the pages of our Service that you visit, the time and date of your visit, the time spent on those pages, unique device identifiers and other diagnostic data.
                        </li>
                        <li>
                            <strong>Cookies and Tracking Data:</strong> We use cookies and similar tracking technologies to track the activity on our Service and hold certain information.
                        </li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">3. Use of Data</h2>
                    <p>
                        Coinpree uses the collected data for various purposes:
                    </p>
                    <ul className="list-disc pl-5 space-y-1 mt-2">
                        <li>To provide and maintain the Service</li>
                        <li>To notify you about changes to our Service</li>
                        <li>To allow you to participate in interactive features of our Service when you choose to do so</li>
                        <li>To provide customer care and support</li>
                        <li>To provide analysis or valuable information so that we can improve the Service</li>
                        <li>To monitor the usage of the Service</li>
                        <li>To detect, prevent and address technical issues</li>
                    </ul>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">4. Transfer of Data</h2>
                    <p>
                        Your information, including Personal Data, may be transferred to — and maintained on — computers located outside of your state, province, country or other governmental jurisdiction where the data protection laws may differ than those from your jurisdiction.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">5. Security of Data</h2>
                    <p>
                        The security of your data is important to us, but remember that no method of transmission over the Internet, or method of electronic storage is 100% secure. While we strive to use commercially acceptable means to protect your Personal Data, we cannot guarantee its absolute security.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">6. Links to Other Sites</h2>
                    <p>
                        Our Service may contain links to other sites that are not operated by us. If you click on a third party link, you will be directed to that third party's site. We strongly advise you to review the Privacy Policy of every site you visit.
                    </p>
                </section>

                <section>
                    <h2 className="text-lg font-bold text-foreground mb-2">7. Changes to This Privacy Policy</h2>
                    <p>
                        We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page. You are advised to review this Privacy Policy periodically for any changes.
                    </p>
                </section>
            </div>
        </div>
    );
}
