import React, { useState, useMemo, useEffect } from 'react';

// Helper function to add scripts to the document head
const loadScript = (src) => {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Script load error for ${src}`));
        document.head.appendChild(script);
    });
};

// Main App Component
const App = () => {
    // === STATE MANAGEMENT ===
    const [extractedData, setExtractedData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: 'fileName', direction: 'ascending' });
    const [filterText, setFilterText] = useState('');
    const [scriptsLoaded, setScriptsLoaded] = useState(false);

    // === SCRIPT LOADING ===
    useEffect(() => {
        // Load updated and more stable versions of external libraries
        Promise.all([
            loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'),
            loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
            loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js')
        ]).then(() => {
            // Set the worker source for pdf.js
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            setScriptsLoaded(true);
        }).catch(err => {
            console.error(err);
            setError('Failed to load required libraries. Please check your network connection and refresh the page.');
        });
    }, []);

    // === DATA EXTRACTION LOGIC ===
    /**
     * Extracts specific financial data points from raw text using multiple regular expression patterns.
     * This makes the extraction more robust across different PDF formats.
     * @param {string} text - The raw text content from a PDF.
     * @returns {object} - An object containing the extracted data.
     */
    const extractDataFromText = (text) => {
        // Helper to try multiple regex patterns and return the first valid match
        const getValue = (patterns, clean = val => val) => {
            for (const pattern of patterns) {
                const match = text.match(pattern);
                // Check for match and ensure it's not just whitespace
                if (match && match[1] && match[1].trim()) {
                    return clean(match[1]);
                }
            }
            return 'N/A';
        };

        // Removes currency symbols, commas, and trims whitespace
        const cleanCurrency = (val) => val.replace(/[$,]/g, '').trim();

        // Define arrays of regex patterns for each data point to handle different PDF layouts
        const patterns = {
            faceAmount: [
                /"Face Amount\s*","[^"]*?([\d,]+\d)/,
                /Sum Assured:\s*.*?([\d,]+\d)/,
                /Initial Death Benefit:\s*.*?([\d,]+\d)/,
                /SPECIFIED FACE AMOUNT:\s*.*?([\d,]+\d)/,
                /SUM ASSURED:\s*.*?([\d,]+\d)/,
            ],
            annualPremium: [
                /"10 Pay\s*","[^"]*?([\d,]+\d)/,
                /Annualised Premium:\s*.*?([\d,]+\d)/,
                /Initial Planned Premium:\s*.*?([\d,]+\.\d{2})/,
                /INITIAL PREMIUM:\s*.*?([\d,]+\d)/,
                /Initial Premium:\s*.*?([\d,]+\d)/,
            ],
            cashValueYear10: [
                // This pattern targets the summary table format seen in the first PDF.
                // It looks for "Year 10" and captures the 'Current' value which is the second value in that row.
                /"Year 10\s*","[^"]*?",\s*"([^"]+)"/,
                 // This pattern looks for a common table structure: Year, Age, ..., Non-Guaranteed Cash Value
                /10\s+60\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+([\d,.]+)\s+[\d,.]+/
            ],
             cashValueYear20: [
                /"Year 20\s*","[^"]*?",\s*"([^"]+)"/,
                /#20\s+70\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+([\d,.]+)\s+[\d,.]+/
            ],
            cashValueYear30: [
                /"Year 30\s*","[^"]*?",\s*"([^"]+)"/,
                /#30\s+80\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+[\d,.]+\s+([\d,.]+)\s+[\d,.]+/
            ],
            guaranteedInterestRate: [
                 /"Guaranteed Interest Rate\s*","([^"]+)"/
            ],
            surrenderPenaltyPeriod: [
                /"Surrender Penalty Period\s*","([^"]+)"/
            ],
            spRating: [
                /"\(S&P\) Financial Strength Rating\s*","([^"]+)"/
            ],
             productCode: [
                /"Product Code\s*","([^"]+)"/
            ],
            currency: [
                /"Currency\s*","([^"]+)"/
            ],
            total10PayPremium:[
                 /Total 10 Pay Premium\s*([,\d]+)/
            ]
        };

        // Extract and return data using the defined patterns
        return {
            productCode: getValue(patterns.productCode),
            currency: getValue(patterns.currency),
            faceAmount: getValue(patterns.faceAmount, cleanCurrency),
            annualPremium: getValue(patterns.annualPremium, cleanCurrency),
            total10PayPremium: getValue(patterns.total10PayPremium, cleanCurrency),
            cashValueYear10: getValue(patterns.cashValueYear10, cleanCurrency),
            cashValueYear20: getValue(patterns.cashValueYear20, cleanCurrency),
            cashValueYear30: getValue(patterns.cashValueYear30, cleanCurrency),
            guaranteedInterestRate: getValue(patterns.guaranteedInterestRate),
            surrenderPenaltyPeriod: getValue(patterns.surrenderPenaltyPeriod),
            spRating: getValue(patterns.spRating),
        };
    };

    /**
     * Parses a single PDF file, extracts text, and then extracts structured data.
     * @param {File} file - The PDF file to process.
     * @returns {Promise<object>} - A promise that resolves with the extracted data.
     */
    const parsePdf = async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            // Added a newline character to help regex distinguish between lines
            fullText += textContent.items.map(item => item.str).join(' ') + '\n';
        }
        
        const data = extractDataFromText(fullText);
        data.fileName = file.name; // Add filename for reference
        return data;
    };

    // === EVENT HANDLERS ===
    /**
     * Handles the file upload event.
     * @param {Event} e - The file input change event.
     */
    const handleFileChange = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0 || !scriptsLoaded) return;

        setLoading(true);
        setError(null);
        setExtractedData([]);

        try {
            const allData = await Promise.all(files.map(file => parsePdf(file)));
            setExtractedData(allData);
        } catch (err) {
            console.error("Error processing files:", err);
            setError('An error occurred while processing the PDFs. Please ensure they are valid and not corrupted.');
        } finally {
            setLoading(false);
        }
    };
    
    /**
     * Generates a PDF report from the currently displayed data.
     */
    const handleGeneratePdf = () => {
        if (filteredData.length === 0) {
            // Use a custom modal or a less intrusive notification in a real app
            alert("No data to export!");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape' });

        doc.text("Illustration Comparison Report", 14, 15);

        const tableHead = [[
            'File Name', 'Product Code', 'Currency', 'Face Amount', 'Annual Premium',
            'Total 10 Pay Premium', 'Cash Value Y10', 'Cash Value Y20', 'Cash Value Y30',
            'Guaranteed Rate', 'Surrender Period', 'S&P Rating'
        ]];
        
        const tableBody = filteredData.map(d => [
            d.fileName, d.productCode, d.currency, d.faceAmount, d.annualPremium,
            d.total10PayPremium, d.cashValueYear10, d.cashValueYear20, d.cashValueYear30,
            d.guaranteedInterestRate, d.surrenderPenaltyPeriod, d.spRating
        ]);

        doc.autoTable({
            startY: 20,
            head: tableHead,
            body: tableBody,
            styles: { fontSize: 7, cellPadding: 1.5 },
            headStyles: { fillColor: [22, 160, 133], textColor: 255 },
            alternateRowStyles: { fillColor: [245, 245, 245] },
            columnStyles: {
                0: { cellWidth: 40 }, // File Name
            }
        });

        doc.save('illustration-comparison.pdf');
    };

    // === DATA SORTING & FILTERING ===
    /**
     * Requests a sort by a specific column key. Toggles direction if key is the same.
     * @param {string} key - The key of the column to sort by.
     */
    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    // Memoized calculation for sorted and filtered data to optimize performance
    const filteredData = useMemo(() => {
        let sortableData = [...extractedData];

        // Sorting logic
        if (sortConfig.key) {
            sortableData.sort((a, b) => {
                const aValue = a[sortConfig.key];
                const bValue = b[sortConfig.key];

                // Attempt to compare as numbers if possible for numeric fields
                const numericKeys = ['faceAmount', 'annualPremium', 'total10PayPremium', 'cashValueYear10', 'cashValueYear20', 'cashValueYear30'];
                let valA, valB;

                if (numericKeys.includes(sortConfig.key)) {
                    valA = parseFloat(aValue) || 0;
                    valB = parseFloat(bValue) || 0;
                } else {
                    valA = aValue?.toString().toLowerCase() || '';
                    valB = bValue?.toString().toLowerCase() || '';
                }

                if (valA < valB) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (valA > valB) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }

        // Filtering logic
        if (!filterText) {
            return sortableData;
        }
        return sortableData.filter(item =>
            Object.values(item).some(val =>
                val?.toString().toLowerCase().includes(filterText.toLowerCase())
            )
        );
    }, [extractedData, sortConfig, filterText]);
    
    // === RENDER COMPONENTS ===

    // Header component for the table
    const SortableHeader = ({ children, columnKey }) => {
        const isSorted = sortConfig.key === columnKey;
        const icon = isSorted ? (sortConfig.direction === 'ascending' ? '▲' : '▼') : '';
        return (
            <th onClick={() => requestSort(columnKey)} className="p-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors duration-200">
                {children} <span className="text-gray-400 ml-1">{icon}</span>
            </th>
        );
    };

    // Main render method
    return (
        <div className="bg-gray-50 min-h-screen font-sans text-gray-800">
            <div className="container mx-auto p-4 md:p-8">
                <header className="text-center mb-8">
                    <h1 className="text-4xl md:text-5xl font-bold text-gray-800">Illustration Comparator</h1>
                    <p className="text-lg text-gray-600 mt-2">Upload, compare, and analyze financial illustration PDFs with ease.</p>
                </header>

                <div className="bg-white p-6 rounded-lg shadow-lg mb-8">
                    <h2 className="text-2xl font-semibold mb-4 text-gray-700">1. Upload Your PDF Files</h2>
                    {!scriptsLoaded ? (
                        <div className="text-center p-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 rounded-md">
                            <p>Loading required libraries, please wait...</p>
                        </div>
                    ) : (
                        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-teal-500 transition-colors duration-300">
                            <input
                                type="file"
                                id="file-upload"
                                multiple
                                accept=".pdf"
                                onChange={handleFileChange}
                                className="hidden"
                                disabled={loading}
                            />
                            <label htmlFor="file-upload" className={`cursor-pointer ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
                                    <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span className="mt-2 block text-sm font-medium text-teal-600">
                                    {loading ? 'Processing PDFs...' : 'Choose files or drag and drop'}
                                </span>
                                <span className="block text-xs text-gray-500">PDF documents only</span>
                            </label>
                        </div>
                    )}
                </div>

                {loading && (
                    <div className="text-center my-8">
                        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-teal-500 mx-auto"></div>
                        <p className="mt-4 text-gray-600">Extracting data from your documents...</p>
                    </div>
                )}

                {error && (
                    <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-8 rounded-md" role="alert">
                        <p className="font-bold">Error</p>
                        <p>{error}</p>
                    </div>
                )}

                {extractedData.length > 0 && !loading && (
                    <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg">
                        <h2 className="text-2xl font-semibold mb-4 text-gray-700">2. Comparison Results</h2>
                        <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-4">
                            <input
                                type="text"
                                placeholder="Filter results..."
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                                className="p-2 border border-gray-300 rounded-md w-full sm:w-1/3 focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                            />
                            <button
                                onClick={handleGeneratePdf}
                                className="bg-teal-600 text-white font-bold py-2 px-4 rounded-md hover:bg-teal-700 transition-transform transform hover:scale-105 duration-300 w-full sm:w-auto"
                            >
                                Generate PDF Report
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <SortableHeader columnKey="fileName">File Name</SortableHeader>
                                        <SortableHeader columnKey="productCode">Product Code</SortableHeader>
                                        <SortableHeader columnKey="currency">Currency</SortableHeader>
                                        <SortableHeader columnKey="faceAmount">Face Amount</SortableHeader>
                                        <SortableHeader columnKey="annualPremium">Annual Premium</SortableHeader>
                                        <SortableHeader columnKey="total10PayPremium">Total 10 Pay Premium</SortableHeader>
                                        <SortableHeader columnKey="cashValueYear10">Cash Value Y10</SortableHeader>
                                        <SortableHeader columnKey="cashValueYear20">Cash Value Y20</SortableHeader>
                                        <SortableHeader columnKey="cashValueYear30">Cash Value Y30</SortableHeader>
                                        <SortableHeader columnKey="guaranteedInterestRate">Guaranteed Rate</SortableHeader>
                                        <SortableHeader columnKey="surrenderPenaltyPeriod">Surrender Period</SortableHeader>
                                        <SortableHeader columnKey="spRating">S&P Rating</SortableHeader>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {filteredData.length > 0 ? filteredData.map((data, index) => (
                                        <tr key={index} className="hover:bg-gray-50 transition-colors duration-200">
                                            <td className="p-3 text-sm text-gray-900 whitespace-nowrap font-medium">{data.fileName}</td>
                                            <td className="p-3 text-sm text-gray-500">{data.productCode}</td>
                                            <td className="p-3 text-sm text-gray-500">{data.currency}</td>
                                            <td className="p-3 text-sm text-gray-500 text-right">{data.faceAmount}</td>
                                            <td className="p-3 text-sm text-gray-500 text-right">{data.annualPremium}</td>
                                            <td className="p-3 text-sm text-gray-500 text-right">{data.total10PayPremium}</td>
                                            <td className="p-3 text-sm text-gray-500 text-right">{data.cashValueYear10}</td>
                                            <td className="p-3 text-sm text-gray-500 text-right">{data.cashValueYear20}</td>
                                            <td className="p-3 text-sm text-gray-500 text-right">{data.cashValueYear30}</td>
                                            <td className="p-3 text-sm text-gray-500 whitespace-nowrap">{data.guaranteedInterestRate}</td>
                                            <td className="p-3 text-sm text-gray-500">{data.surrenderPenaltyPeriod}</td>
                                            <td className="p-3 text-sm text-gray-500">{data.spRating}</td>
                                        </tr>
                                    )) : (
                                        <tr>
                                            <td colSpan="12" className="text-center p-6 text-gray-500">No results match your filter.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
